#!/usr/bin/env python3
"""Generate Dataset Manifest v2 packages from tangible-table model specs."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import math
import os
import re
import shutil
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence

import yaml


MANIFEST_SCHEMA_VERSION = "dtcc-dataset-manifest-v2"
SAFE_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]*$")


class SpecError(ValueError):
    """Raised when table model specs are missing or malformed."""


class GenerationError(RuntimeError):
    """Raised when generation cannot proceed safely."""


@dataclass(frozen=True)
class PhysicalSpec:
    width_mm: float
    height_mm: float
    scale: float


@dataclass(frozen=True)
class CatalogSpec:
    dataset_key_prefix: str
    output_dir: Path


@dataclass(frozen=True)
class TableModelSpec:
    model_id: str
    title: str
    crs: str
    bounds: tuple[float, float, float, float]
    physical: PhysicalSpec
    catalog: CatalogSpec


@dataclass(frozen=True)
class ExportSpec:
    format: str
    filename: str
    media_type: str | None
    data_kind: str | None
    crs: str | None


@dataclass(frozen=True)
class TableSpec:
    role: str
    dataset_key_suffix: str
    publish: bool
    default_enabled: bool
    requires_network: bool
    skip_reason: str | None


@dataclass(frozen=True)
class TableDatasetSpec:
    id: str
    dataset: str
    title: str
    description: str
    params: dict[str, Any]
    export: ExportSpec
    table: TableSpec

    @property
    def dataset_key_suffix(self) -> str:
        return self.table.dataset_key_suffix or self.id


DatasetFactory = Callable[..., Any]


def load_specs(root_dir: Path, model_id: str) -> tuple[TableModelSpec, tuple[TableDatasetSpec, ...]]:
    """Load and validate one model profile and its dataset specs."""
    model_dir = _model_dir(root_dir, model_id)
    model = _load_model_spec(model_dir / "model.yaml", expected_model_id=model_id)
    datasets = _load_dataset_specs(model_dir / "datasets.yaml")
    return model, datasets


def generate_catalog(
    model_id: str,
    *,
    root_dir: Path | None = None,
    output_dir: Path | None = None,
    only: Sequence[str] = (),
    skip: Sequence[str] = (),
    clean: bool = False,
    dry_run: bool = False,
    publish: bool = False,
    upload_url: str | None = None,
    token: str | None = None,
    env: Mapping[str, str] | None = None,
    dataset_registry: Mapping[str, DatasetFactory] | None = None,
) -> dict[str, Any]:
    """Generate table catalog packages and return a machine-readable report."""
    root = Path(root_dir or Path.cwd()).resolve()
    model, dataset_specs = load_specs(root, model_id)
    selected, skipped = _select_dataset_specs(dataset_specs, only=only, skip=skip)
    resolved_output_dir = Path(output_dir) if output_dir is not None else model.catalog.output_dir
    if not resolved_output_dir.is_absolute():
        resolved_output_dir = root / resolved_output_dir
    resolved_output_dir = resolved_output_dir.resolve()

    publish_config = None
    if publish:
        publish_config = _resolve_publish_config(
            upload_url=upload_url,
            token=token,
            env=env or os.environ,
        )

    report: dict[str, Any] = {
        "model_id": model.model_id,
        "title": model.title,
        "crs": model.crs,
        "bounds": list(model.bounds),
        "output_dir": str(resolved_output_dir),
        "dry_run": dry_run,
        "publish": publish,
        "planned": [
            _report_planned_item(model, spec)
            for spec in selected
        ],
        "generated": [],
        "published": [],
        "skipped": skipped,
    }

    if dry_run:
        return report

    _prepare_output_dir(resolved_output_dir, clean=clean)

    for spec in selected:
        generated = _generate_one(
            model,
            spec,
            output_dir=resolved_output_dir,
            dataset_registry=dataset_registry,
        )
        report["generated"].append(generated)
        if publish and generated["publish_requested"]:
            assert publish_config is not None
            publication = _publish_package(
                generated,
                dataset_key=generated["dataset_key"],
                upload_url=publish_config[0],
                token=publish_config[1],
            )
            report["published"].append(publication)
        elif publish:
            report["skipped"].append(
                {
                    "id": spec.id,
                    "reason": "table spec publish=false; package generated local-only",
                }
            )

    report_path = resolved_output_dir / "generation_report.json"
    report_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    report["report_path"] = str(report_path)
    return report


def _model_dir(root_dir: Path, model_id: str) -> Path:
    if not SAFE_ID_RE.match(model_id):
        raise SpecError(
            "model_id must contain only letters, numbers, dot, underscore, or hyphen "
            f"and must not be a path: {model_id!r}"
        )
    return root_dir / "table_models" / model_id


def _read_yaml_mapping(path: Path) -> dict[str, Any]:
    if not path.is_file():
        raise SpecError(f"Required spec file does not exist: {path}")
    with path.open("r", encoding="utf-8") as handle:
        data = yaml.safe_load(handle)
    if not isinstance(data, dict):
        raise SpecError(f"{path} must contain a YAML mapping")
    return data


def _load_model_spec(path: Path, *, expected_model_id: str) -> TableModelSpec:
    data = _read_yaml_mapping(path)
    model_id = _required_str(data, "model_id", "model.yaml")
    if model_id != expected_model_id:
        raise SpecError(
            f"model.yaml model_id {model_id!r} does not match requested model_id {expected_model_id!r}"
        )
    title = _required_str(data, "title", "model.yaml")
    crs = _required_str(data, "crs", "model.yaml")
    bounds = _required_bounds(data, "bounds", "model.yaml")
    physical_data = _required_mapping(data, "physical", "model.yaml")
    catalog_data = _required_mapping(data, "catalog", "model.yaml")

    physical = PhysicalSpec(
        width_mm=_required_positive_number(physical_data, "width_mm", "model.yaml physical"),
        height_mm=_required_positive_number(physical_data, "height_mm", "model.yaml physical"),
        scale=_required_positive_number(physical_data, "scale", "model.yaml physical"),
    )
    catalog = CatalogSpec(
        dataset_key_prefix=_required_str(catalog_data, "dataset_key_prefix", "model.yaml catalog"),
        output_dir=Path(_required_str(catalog_data, "output_dir", "model.yaml catalog")),
    )
    return TableModelSpec(
        model_id=model_id,
        title=title,
        crs=crs,
        bounds=bounds,
        physical=physical,
        catalog=catalog,
    )


def _load_dataset_specs(path: Path) -> tuple[TableDatasetSpec, ...]:
    data = _read_yaml_mapping(path)
    raw_datasets = data.get("datasets")
    if not isinstance(raw_datasets, list) or not raw_datasets:
        raise SpecError("datasets.yaml must contain a non-empty datasets list")

    specs = []
    seen_ids: set[str] = set()
    for index, raw in enumerate(raw_datasets):
        where = f"datasets.yaml datasets[{index}]"
        if not isinstance(raw, dict):
            raise SpecError(f"{where} must be a mapping")
        dataset_id = _required_str(raw, "id", where)
        if not SAFE_ID_RE.match(dataset_id):
            raise SpecError(f"{where}.id must be a safe id, got {dataset_id!r}")
        if dataset_id in seen_ids:
            raise SpecError(f"datasets.yaml contains duplicate dataset id {dataset_id!r}")
        seen_ids.add(dataset_id)

        params = _required_mapping(raw, "params", where)
        if "bounds" in params:
            raise SpecError(
                f"{where}.params must not contain bounds; model.yaml bounds are authoritative"
            )
        export_data = _required_mapping(raw, "export", where)
        table_data = _required_mapping(raw, "table", where)
        default_enabled = _optional_bool(table_data, "default_enabled", True, f"{where}.table")
        skip_reason = _optional_str(table_data, "skip_reason", f"{where}.table")
        if not default_enabled and not skip_reason:
            raise SpecError(f"{where}.table.skip_reason is required when default_enabled is false")

        spec = TableDatasetSpec(
            id=dataset_id,
            dataset=_required_str(raw, "dataset", where),
            title=_required_str(raw, "title", where),
            description=_required_str(raw, "description", where),
            params=copy.deepcopy(dict(params)),
            export=ExportSpec(
                format=_required_str(export_data, "format", f"{where}.export").lower().lstrip("."),
                filename=_required_filename(export_data, "filename", f"{where}.export"),
                media_type=_optional_str(export_data, "media_type", f"{where}.export"),
                data_kind=_optional_str(export_data, "data_kind", f"{where}.export"),
                crs=_optional_str(export_data, "crs", f"{where}.export"),
            ),
            table=TableSpec(
                role=_required_str(table_data, "role", f"{where}.table"),
                dataset_key_suffix=_optional_str(table_data, "dataset_key_suffix", f"{where}.table") or dataset_id,
                publish=_optional_bool(table_data, "publish", False, f"{where}.table"),
                default_enabled=default_enabled,
                requires_network=_optional_bool(table_data, "requires_network", False, f"{where}.table"),
                skip_reason=skip_reason,
            ),
        )
        specs.append(spec)
    return tuple(specs)


def _select_dataset_specs(
    specs: Sequence[TableDatasetSpec],
    *,
    only: Sequence[str],
    skip: Sequence[str],
) -> tuple[list[TableDatasetSpec], list[dict[str, str]]]:
    by_id = {spec.id: spec for spec in specs}
    unknown_only = sorted(set(only) - set(by_id))
    if unknown_only:
        raise SpecError(f"--only references unknown dataset id: {unknown_only[0]}")
    unknown_skip = sorted(set(skip) - set(by_id))
    if unknown_skip:
        raise SpecError(f"--skip references unknown dataset id: {unknown_skip[0]}")

    selected = []
    skipped = []
    only_set = set(only)
    skip_set = set(skip)
    for spec in specs:
        if spec.id in skip_set:
            skipped.append({"id": spec.id, "reason": "explicitly skipped by --skip"})
            continue
        if only_set and spec.id not in only_set:
            skipped.append({"id": spec.id, "reason": "not selected by --only"})
            continue
        if not only_set and not spec.table.default_enabled:
            skipped.append({"id": spec.id, "reason": spec.table.skip_reason or "disabled by spec"})
            continue
        selected.append(spec)
    return selected, skipped


def _prepare_output_dir(output_dir: Path, *, clean: bool) -> None:
    if output_dir.exists():
        if output_dir.is_file():
            raise GenerationError(f"Output directory path is a file: {output_dir}")
        if any(output_dir.iterdir()):
            if not clean:
                raise GenerationError(
                    f"Output directory is not empty: {output_dir}. "
                    "Pass --clean or choose --output-dir."
                )
            shutil.rmtree(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)


def _generate_one(
    model: TableModelSpec,
    spec: TableDatasetSpec,
    *,
    output_dir: Path,
    dataset_registry: Mapping[str, DatasetFactory] | None,
) -> dict[str, Any]:
    dataset = _resolve_dataset(spec.dataset, dataset_registry)
    params = copy.deepcopy(spec.params)
    params["bounds"] = list(model.bounds)

    package_dir = output_dir / spec.id
    obj = dataset(**params)
    package = obj.export(package_dir, format=spec.export.format)
    manifest_path = package_dir / "manifest.json"
    manifest = _read_json_manifest(manifest_path)
    primary_artifact = _select_primary_artifact(manifest, spec)
    _rename_primary_artifact(package_dir, primary_artifact, spec.export.filename)
    _apply_table_manifest_overrides(manifest, model, spec)
    _write_json(manifest_path, manifest)
    artifact_paths = _validate_package(
        package_dir,
        expected_bounds=list(model.bounds),
        spec=spec,
    )

    dataset_key = f"{model.catalog.dataset_key_prefix}-{spec.dataset_key_suffix}"
    return {
        "id": spec.id,
        "dataset": spec.dataset,
        "dataset_key": dataset_key,
        "package_dir": str(package_dir),
        "manifest_path": str(manifest_path),
        "artifacts": [str(path) for path in artifact_paths],
        "publish_requested": spec.table.publish,
        "table_role": spec.table.role,
    }


def _resolve_dataset(name: str, registry: Mapping[str, DatasetFactory] | None) -> DatasetFactory:
    if registry is not None and name in registry:
        return registry[name]
    if "." not in name:
        import dtcc_core.datasets as datasets

        dataset = getattr(datasets, name, None)
        if dataset is None:
            raise GenerationError(f"Unknown dtcc_core dataset: {name}")
        if not callable(dataset):
            raise GenerationError(f"Resolved dataset is not callable: {name}")
        return dataset

    module_name, _, attr = name.rpartition(".")
    if not module_name or not attr:
        raise GenerationError(f"Invalid dataset import path: {name}")
    module = __import__(module_name, fromlist=[attr])
    dataset = getattr(module, attr, None)
    if dataset is None or not callable(dataset):
        raise GenerationError(f"Dataset import path did not resolve to a callable: {name}")
    return dataset


def _read_json_manifest(path: Path) -> dict[str, Any]:
    if not path.is_file():
        raise GenerationError(f"Generated package is missing manifest.json: {path}")
    with path.open("r", encoding="utf-8") as handle:
        manifest = json.load(handle)
    if not isinstance(manifest, dict):
        raise GenerationError(f"{path} must contain a JSON object")
    return manifest


def _select_primary_artifact(manifest: dict[str, Any], spec: TableDatasetSpec) -> dict[str, Any]:
    artifacts = manifest.get("artifacts")
    if not isinstance(artifacts, list) or not artifacts:
        raise GenerationError(f"{spec.id} package manifest must contain non-empty artifacts")
    for artifact in artifacts:
        if isinstance(artifact, dict) and artifact.get("format") == spec.export.format:
            return artifact
    raise GenerationError(
        f"{spec.id} package manifest has no artifact with format {spec.export.format!r}"
    )


def _rename_primary_artifact(package_dir: Path, artifact: dict[str, Any], filename: str) -> None:
    current_path_value = artifact.get("path")
    if not isinstance(current_path_value, str) or not current_path_value:
        raise GenerationError("Manifest artifact is missing path")
    current_path = _resolve_package_path(package_dir, current_path_value)
    target_path = package_dir / "artifacts" / filename
    if current_path == target_path:
        artifact["size"] = current_path.stat().st_size
        artifact["sha256"] = _sha256_file(current_path)
        return
    if target_path.exists():
        raise GenerationError(f"Cannot rename artifact because target exists: {target_path}")
    target_path.parent.mkdir(parents=True, exist_ok=True)
    current_path.rename(target_path)
    artifact["path"] = target_path.relative_to(package_dir).as_posix()
    artifact["size"] = target_path.stat().st_size
    artifact["sha256"] = _sha256_file(target_path)


def _apply_table_manifest_overrides(
    manifest: dict[str, Any],
    model: TableModelSpec,
    spec: TableDatasetSpec,
) -> None:
    identity = _ensure_mapping(manifest, "identity", "manifest")
    metadata = _ensure_mapping(manifest, "metadata", "manifest")
    presentation = _ensure_mapping(manifest, "presentation", "manifest")
    request = _ensure_mapping(manifest, "request", "manifest")

    identity["title"] = spec.title
    metadata["description"] = spec.description
    presentation["headline"] = spec.title
    presentation["summary"] = spec.description
    view_hints = presentation.get("view_hints")
    if not isinstance(view_hints, dict):
        view_hints = {}
    view_hints.update(
        {
            "profile": "table",
            "table_model_id": model.model_id,
            "table_role": spec.table.role,
            "physical_width_mm": model.physical.width_mm,
            "physical_height_mm": model.physical.height_mm,
            "physical_scale": model.physical.scale,
            "expected_format": spec.export.format,
        }
    )
    if spec.export.media_type is not None:
        view_hints["expected_media_type"] = spec.export.media_type
    if spec.export.data_kind is not None:
        view_hints["expected_data_kind"] = spec.export.data_kind
    if spec.export.crs is not None:
        view_hints["expected_crs"] = spec.export.crs
    presentation["view_hints"] = view_hints
    request["bounds"] = list(model.bounds)
    params = request.get("parameters")
    if isinstance(params, dict):
        params["bounds"] = list(model.bounds)


def _validate_package(
    package_dir: Path,
    *,
    expected_bounds: list[float],
    spec: TableDatasetSpec,
) -> list[Path]:
    manifest_path = package_dir / "manifest.json"
    manifest = _read_json_manifest(manifest_path)
    if manifest.get("schema_version") != MANIFEST_SCHEMA_VERSION:
        raise GenerationError(
            f"{manifest_path} must declare schema_version={MANIFEST_SCHEMA_VERSION!r}"
        )
    request = manifest.get("request")
    if not isinstance(request, dict) or request.get("bounds") != expected_bounds:
        raise GenerationError(f"{manifest_path} request.bounds must equal model bounds")
    artifacts = manifest.get("artifacts")
    if not isinstance(artifacts, list) or not artifacts:
        raise GenerationError(f"{manifest_path} must contain non-empty artifacts")

    artifact_paths = []
    seen_paths: set[str] = set()
    for index, artifact in enumerate(artifacts):
        if not isinstance(artifact, dict):
            raise GenerationError(f"{manifest_path} artifact {index} must be an object")
        path_value = artifact.get("path")
        if not isinstance(path_value, str):
            raise GenerationError(f"{manifest_path} artifact {index} must include path")
        if path_value in seen_paths:
            raise GenerationError(f"{manifest_path} has duplicate artifact path {path_value!r}")
        seen_paths.add(path_value)
        artifact_path = _resolve_package_path(package_dir, path_value)
        if not artifact_path.is_file():
            raise GenerationError(f"{manifest_path} references missing artifact {path_value}")
        expected_size = artifact.get("size")
        if expected_size is not None and expected_size != artifact_path.stat().st_size:
            raise GenerationError(f"{manifest_path} artifact {path_value} size does not match")
        expected_sha = artifact.get("sha256")
        if expected_sha is not None and expected_sha != _sha256_file(artifact_path):
            raise GenerationError(f"{manifest_path} artifact {path_value} sha256 does not match")
        artifact_paths.append(artifact_path)
    _validate_expected_primary_artifact(manifest, spec, manifest_path)
    return artifact_paths


def _validate_expected_primary_artifact(
    manifest: Mapping[str, Any],
    spec: TableDatasetSpec,
    manifest_path: Path,
) -> None:
    primary = _select_primary_artifact(dict(manifest), spec)
    expected_path = f"artifacts/{spec.export.filename}"
    if primary.get("path") != expected_path:
        raise GenerationError(
            f"{manifest_path} primary {spec.export.format!r} artifact path must "
            f"be {expected_path!r}"
        )
    expectations = {
        "media_type": spec.export.media_type,
        "data_kind": spec.export.data_kind,
        "crs": spec.export.crs,
    }
    for field_name, expected_value in expectations.items():
        if expected_value is None:
            continue
        if primary.get(field_name) != expected_value:
            raise GenerationError(
                f"{manifest_path} primary artifact {field_name} must be "
                f"{expected_value!r}; got {primary.get(field_name)!r}"
            )


def _publish_package(
    generated: Mapping[str, Any],
    *,
    dataset_key: str,
    upload_url: str,
    token: str,
) -> dict[str, Any]:
    from dtcc_core.datasets.publish import DatasetUploadClient

    manifest_path = Path(str(generated["manifest_path"]))
    manifest = _read_json_manifest(manifest_path)
    files = tuple(Path(path) for path in generated["artifacts"])
    client = DatasetUploadClient.from_config(upload_url=upload_url, token=token)
    publication = client.upload_package(
        dataset_key=dataset_key,
        manifest_path=manifest_path,
        files=files,
        manifest=manifest,
    )
    return {
        "id": generated["id"],
        "dataset_key": publication.dataset_key,
        "version_number": publication.version_number,
    }


def _resolve_publish_config(
    *,
    upload_url: str | None,
    token: str | None,
    env: Mapping[str, str],
) -> tuple[str, str]:
    resolved_url = (upload_url if upload_url is not None else env.get("DTCC_UPLOAD_URL") or "").strip()
    resolved_token = (token if token is not None else env.get("DTCC_UPLOAD_TOKEN") or "").strip()
    if not resolved_url:
        raise GenerationError(
            "--publish requires a non-empty upload URL. "
            "Pass --upload-url or set DTCC_UPLOAD_URL."
        )
    if not resolved_token:
        raise GenerationError(
            "--publish requires a non-empty upload token. "
            "Pass --token or set DTCC_UPLOAD_TOKEN."
        )
    return resolved_url, resolved_token


def _report_planned_item(model: TableModelSpec, spec: TableDatasetSpec) -> dict[str, Any]:
    return {
        "id": spec.id,
        "dataset": spec.dataset,
        "dataset_key": f"{model.catalog.dataset_key_prefix}-{spec.dataset_key_suffix}",
        "format": spec.export.format,
        "filename": spec.export.filename,
        "table_role": spec.table.role,
        "publish_requested": spec.table.publish,
        "requires_network": spec.table.requires_network,
        "media_type": spec.export.media_type,
        "data_kind": spec.export.data_kind,
        "crs": spec.export.crs,
    }


def _required_mapping(data: Mapping[str, Any], key: str, where: str) -> dict[str, Any]:
    if key not in data:
        raise SpecError(f"{where} missing required field {key}")
    value = data[key]
    if not isinstance(value, dict):
        raise SpecError(f"{where}.{key} must be a mapping")
    return value


def _ensure_mapping(data: dict[str, Any], key: str, where: str) -> dict[str, Any]:
    value = data.get(key)
    if not isinstance(value, dict):
        value = {}
        data[key] = value
    return value


def _required_str(data: Mapping[str, Any], key: str, where: str) -> str:
    if key not in data:
        raise SpecError(f"{where} missing required field {key}")
    value = data[key]
    if not isinstance(value, str) or not value.strip():
        raise SpecError(f"{where}.{key} must be a non-empty string")
    return value.strip()


def _optional_str(data: Mapping[str, Any], key: str, where: str) -> str | None:
    if key not in data or data[key] is None:
        return None
    value = data[key]
    if not isinstance(value, str) or not value.strip():
        raise SpecError(f"{where}.{key} must be a non-empty string when present")
    return value.strip()


def _optional_bool(data: Mapping[str, Any], key: str, default: bool, where: str) -> bool:
    if key not in data:
        return default
    value = data[key]
    if not isinstance(value, bool):
        raise SpecError(f"{where}.{key} must be true or false")
    return value


def _required_positive_number(data: Mapping[str, Any], key: str, where: str) -> float:
    if key not in data:
        raise SpecError(f"{where} missing required field {key}")
    value = data[key]
    if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value) or value <= 0:
        raise SpecError(f"{where}.{key} must be a positive finite number")
    return float(value)


def _required_bounds(data: Mapping[str, Any], key: str, where: str) -> tuple[float, float, float, float]:
    if key not in data:
        raise SpecError(f"{where} missing required field {key}")
    value = data[key]
    if (
        not isinstance(value, list)
        or len(value) != 4
        or any(not isinstance(item, (int, float)) or isinstance(item, bool) or not math.isfinite(item) for item in value)
    ):
        raise SpecError(f"{where}.{key} must be four finite numbers")
    bounds = tuple(float(item) for item in value)
    if bounds[0] >= bounds[2] or bounds[1] >= bounds[3]:
        raise SpecError(f"{where}.{key} must satisfy xmin < xmax and ymin < ymax")
    return bounds


def _required_filename(data: Mapping[str, Any], key: str, where: str) -> str:
    value = _required_str(data, key, where)
    if "\\" in value or "/" in value or value in {".", ".."} or value.startswith("."):
        raise SpecError(f"{where}.{key} must be a file name, not a path")
    if Path(value).is_absolute() or "://" in value:
        raise SpecError(f"{where}.{key} must be a relative file name")
    return value


def _resolve_package_path(package_dir: Path, relative_path: str) -> Path:
    if not _safe_relative_path(relative_path):
        raise GenerationError(f"Invalid package artifact path: {relative_path!r}")
    path = (package_dir / relative_path).resolve()
    try:
        path.relative_to(package_dir.resolve())
    except ValueError as exc:
        raise GenerationError(f"Package artifact path escapes package directory: {relative_path}") from exc
    return path


def _safe_relative_path(value: str) -> bool:
    if not value or "\\" in value or value.startswith("/") or "://" in value:
        return False
    if re.match(r"^[A-Za-z]:", value):
        return False
    return all(part not in {"", ".", ".."} and not part.startswith(".") for part in value.split("/"))


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _write_json(path: Path, value: Mapping[str, Any]) -> None:
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _build_parser() -> argparse.ArgumentParser:
    examples = """examples:
  python scripts/generate_table_catalog.py gbg_500m_2026_07
  python scripts/generate_table_catalog.py gbg_500m_2026_07 --dry-run
  python scripts/generate_table_catalog.py gbg_500m_2026_07 --only calibration_grid --clean
  DTCC_UPLOAD_URL=https://upload.example DTCC_UPLOAD_TOKEN=... python scripts/generate_table_catalog.py gbg_500m_2026_07 --publish
"""
    parser = argparse.ArgumentParser(
        description=(
            "Generate local Dataset Manifest v2 packages from tangible-table "
            "model.yaml and datasets.yaml specs."
        ),
        epilog=examples,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("model_id", help="Table model id under table_models/.")
    parser.add_argument("--output-dir", metavar="PATH", help="Override catalog output directory.")
    parser.add_argument("--only", action="append", default=[], metavar="ID", help="Generate only one dataset id. May be repeated.")
    parser.add_argument("--skip", action="append", default=[], metavar="ID", help="Skip one dataset id. May be repeated.")
    parser.add_argument("--clean", action="store_true", help="Delete an existing non-empty output directory before generation.")
    parser.add_argument("--dry-run", action="store_true", help="Validate specs and print the planned actions without running datasets.")
    parser.add_argument("--publish", action="store_true", help="Publish generated packages after validation.")
    parser.add_argument("--upload-url", help="Upload endpoint for --publish. Defaults to DTCC_UPLOAD_URL.")
    parser.add_argument("--token", help="Upload token for --publish. Defaults to DTCC_UPLOAD_TOKEN.")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    try:
        report = generate_catalog(
            args.model_id,
            output_dir=Path(args.output_dir) if args.output_dir else None,
            only=args.only,
            skip=args.skip,
            clean=args.clean,
            dry_run=args.dry_run,
            publish=args.publish,
            upload_url=args.upload_url,
            token=args.token,
        )
    except (SpecError, GenerationError, ValueError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2

    if args.dry_run:
        print(json.dumps(report, indent=2, sort_keys=True))
    else:
        print(
            f"DONE: generated {len(report['generated'])} package(s), "
            f"published {len(report['published'])}, skipped {len(report['skipped'])}."
        )
        if report.get("report_path"):
            print(f"Wrote report to {report['report_path']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
