#!/usr/bin/env python3
"""Generate Dataset Manifest v2 packages from tangible-table model specs."""

from __future__ import annotations

import argparse
import copy
import hashlib
import importlib
import importlib.util
import json
import math
import os
import re
import shutil
import sys
import tempfile
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence

import yaml


MANIFEST_SCHEMA_VERSION = "dtcc-dataset-manifest-v2"
SAFE_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]*$")
VALID_TIERS = ("core", "dev", "credentialed", "simulation", "expensive")
INCLUDE_SELECTIONS = {
    "default": frozenset({"core"}),
    "core": frozenset({"core"}),
    "dev": frozenset({"core", "dev"}),
    "credentialed": frozenset({"core", "credentialed"}),
    "simulation": frozenset({"core", "simulation"}),
    "expensive": frozenset({"core", "expensive"}),
    "all": frozenset(VALID_TIERS),
}
TIER_SELECTIONS = INCLUDE_SELECTIONS


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
    media_type: str
    data_kind: str
    crs: str | None
    renderer: str | None
    plot: dict[str, Any]
    width_px: int
    height_px: int
    dpi: int


@dataclass(frozen=True)
class TableSpec:
    tier: str
    role: str
    reason: str
    dataset_key_suffix: str
    publish: bool
    requires_network: bool
    required_env: tuple[str, ...]
    required_python: tuple[str, ...]
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
    include: Sequence[str] | str | None = None,
    tier: Sequence[str] | str | None = None,
    only: Sequence[str] = (),
    skip: Sequence[str] = (),
    clean: bool = False,
    dry_run: bool = False,
    strict: bool = False,
    run_expensive: bool = False,
    publish: bool = False,
    upload_url: str | None = None,
    token: str | None = None,
    env: Mapping[str, str] | None = None,
    dataset_registry: Mapping[str, DatasetFactory] | None = None,
) -> dict[str, Any]:
    """Generate table catalog packages and return a machine-readable report."""
    root = Path(root_dir or Path.cwd()).resolve()
    resolved_env = os.environ if env is None else env
    model, dataset_specs = load_specs(root, model_id)
    selected_tiers = _resolve_tiers(include=include, tier=tier)
    selected, skipped = _select_dataset_specs(
        dataset_specs,
        only=only,
        skip=skip,
        tiers=selected_tiers,
        strict=strict,
        run_expensive=run_expensive,
        env=resolved_env,
    )
    resolved_output_dir = Path(output_dir) if output_dir is not None else model.catalog.output_dir
    if not resolved_output_dir.is_absolute():
        resolved_output_dir = root / resolved_output_dir
    resolved_output_dir = resolved_output_dir.resolve()

    publish_config = None
    if publish:
        publish_config = _resolve_publish_config(
            upload_url=upload_url,
            token=token,
            env=resolved_env,
        )

    report: dict[str, Any] = {
        "model_id": model.model_id,
        "title": model.title,
        "crs": model.crs,
        "bounds": list(model.bounds),
        "output_dir": str(resolved_output_dir),
        "dry_run": dry_run,
        "publish": publish,
        "selected_tiers": sorted(selected_tiers),
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
        tier = _required_str(table_data, "tier", f"{where}.table")
        if tier not in VALID_TIERS:
            raise SpecError(
                f"{where}.table.tier must be one of {', '.join(VALID_TIERS)}, got {tier!r}"
            )
        reason = _optional_str(table_data, "reason", f"{where}.table") or _optional_str(
            table_data,
            "ux_purpose",
            f"{where}.table",
        )
        if reason is None:
            raise SpecError(f"{where}.table.reason is required")
        skip_reason = _optional_str(table_data, "skip_reason", f"{where}.table")

        spec = TableDatasetSpec(
            id=dataset_id,
            dataset=_required_str(raw, "dataset", where),
            title=_required_str(raw, "title", where),
            description=_required_str(raw, "description", where),
            params=copy.deepcopy(dict(params)),
            export=ExportSpec(
                format=_required_str(export_data, "format", f"{where}.export").lower().lstrip("."),
                filename=_required_filename(export_data, "filename", f"{where}.export"),
                media_type=_required_str(export_data, "media_type", f"{where}.export"),
                data_kind=_required_str(export_data, "data_kind", f"{where}.export"),
                crs=_optional_str(export_data, "crs", f"{where}.export"),
                renderer=_optional_str(export_data, "renderer", f"{where}.export"),
                plot=_optional_mapping(export_data, "plot", f"{where}.export"),
                width_px=_optional_positive_int(export_data, "width_px", 1920, f"{where}.export"),
                height_px=_optional_positive_int(export_data, "height_px", 1920, f"{where}.export"),
                dpi=_optional_positive_int(export_data, "dpi", 160, f"{where}.export"),
            ),
            table=TableSpec(
                tier=tier,
                role=_required_str(table_data, "role", f"{where}.table"),
                reason=reason,
                dataset_key_suffix=_optional_str(table_data, "dataset_key_suffix", f"{where}.table") or dataset_id,
                publish=_optional_bool(table_data, "publish", False, f"{where}.table"),
                requires_network=_optional_bool(table_data, "requires_network", False, f"{where}.table"),
                required_env=_optional_str_tuple(table_data, "required_env", f"{where}.table"),
                required_python=_optional_str_tuple(table_data, "required_python", f"{where}.table"),
                skip_reason=skip_reason,
            ),
        )
        specs.append(spec)
    return tuple(specs)


def _selection_was_provided(value: Sequence[str] | str | None) -> bool:
    return value is not None and value != () and value != []


def _resolve_tiers(
    *,
    include: Sequence[str] | str | None = None,
    tier: Sequence[str] | str | None = None,
) -> frozenset[str]:
    if _selection_was_provided(include) and _selection_was_provided(tier):
        raise SpecError("Use either --include or legacy --tier, not both.")
    selection = include if _selection_was_provided(include) else tier
    if not _selection_was_provided(selection):
        return INCLUDE_SELECTIONS["default"]
    raw_values = [selection] if isinstance(selection, str) else list(selection)
    requested: set[str] = set()
    for raw_value in raw_values:
        for item in str(raw_value).split(","):
            normalized = item.strip().lower()
            if not normalized:
                continue
            if normalized not in INCLUDE_SELECTIONS:
                raise SpecError(
                    f"Unknown include set {normalized!r}; expected one of "
                    f"{', '.join(INCLUDE_SELECTIONS)}"
                )
            requested.update(INCLUDE_SELECTIONS[normalized])
    if not requested:
        return INCLUDE_SELECTIONS["default"]
    return frozenset(requested)


def _select_dataset_specs(
    specs: Sequence[TableDatasetSpec],
    *,
    only: Sequence[str],
    skip: Sequence[str],
    tiers: frozenset[str],
    strict: bool,
    run_expensive: bool,
    env: Mapping[str, str],
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
            skipped.append(_report_skipped_item(spec, "explicitly skipped by --skip"))
            continue
        if only_set and spec.id not in only_set:
            skipped.append(_report_skipped_item(spec, "not selected by --only"))
            continue
        if not only_set and spec.table.tier not in tiers:
            skipped.append(
                _report_skipped_item(
                    spec,
                    f"not included by this selection; use --include {spec.table.tier}",
                )
            )
            continue
        dependency_issues = _table_dependency_issues(
            spec,
            env=env,
            run_expensive=run_expensive,
        )
        if dependency_issues:
            reason = "; ".join(dependency_issues)
            if strict:
                raise GenerationError(f"{spec.id}: {reason}")
            skipped.append(_report_skipped_item(spec, reason))
            continue
        selected.append(spec)
    return selected, skipped


def _table_dependency_issues(
    spec: TableDatasetSpec,
    *,
    env: Mapping[str, str],
    run_expensive: bool,
) -> list[str]:
    issues: list[str] = []
    expensive_allowed = run_expensive or bool(
        (env.get("DTCC_EXPENSIVE_TABLE_DATASETS") or "").strip()
    )
    if spec.table.tier == "expensive" and not expensive_allowed:
        issues.append(
            "expensive tier requires --run-expensive or "
            "DTCC_EXPENSIVE_TABLE_DATASETS=1"
        )
        return issues
    for variable in spec.table.required_env:
        if not (env.get(variable) or "").strip():
            issues.append(f"missing required environment variable {variable}")
    for module_name in spec.table.required_python:
        if not _module_spec_exists_without_import(module_name):
            issues.append(f"missing required Python module {module_name}")
    return issues


def _module_spec_exists_without_import(module_name: str) -> bool:
    """Return whether a module can be found without importing parent packages."""
    parts = module_name.split(".")
    if any(not part for part in parts):
        return False
    if len(parts) == 1:
        try:
            return importlib.util.find_spec(module_name) is not None
        except (ImportError, ModuleNotFoundError, ValueError):
            return False

    fullname = parts[0]
    try:
        spec = importlib.machinery.PathFinder.find_spec(fullname)
    except (ImportError, ModuleNotFoundError, ValueError):
        return False
    for part in parts[1:]:
        if spec is None or spec.submodule_search_locations is None:
            return False
        fullname = f"{fullname}.{part}"
        try:
            spec = importlib.machinery.PathFinder.find_spec(
                fullname,
                list(spec.submodule_search_locations),
            )
        except (ImportError, ModuleNotFoundError, ValueError):
            return False
    return spec is not None


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
    _import_required_modules(spec.table.required_python)
    dataset = _resolve_dataset(spec.dataset, dataset_registry)
    params = copy.deepcopy(spec.params)
    params["bounds"] = list(model.bounds)

    archive_path = output_dir / f"{spec.id}.dtccpkg"
    if archive_path.exists():
        raise GenerationError(f"Dataset package archive already exists: {archive_path}")

    with tempfile.TemporaryDirectory(prefix=f".{spec.id}-", dir=output_dir) as tmpdir:
        package_dir = Path(tmpdir) / spec.id
        obj = dataset(**params)
        if spec.export.renderer == "plot":
            _export_plot_media_package(
                obj,
                package_dir=package_dir,
                model=model,
                spec=spec,
            )
        elif spec.export.renderer == "mesh_topdown":
            _export_mesh_topdown_package(
                obj,
                package_dir=package_dir,
                model=model,
                spec=spec,
            )
        elif spec.export.renderer is not None:
            raise GenerationError(
                f"{spec.id} uses unsupported export.renderer {spec.export.renderer!r}"
            )
        elif isinstance(obj, (bytes, bytearray, str)):
            _export_serialized_payload_package(
                obj,
                dataset=dataset,
                params=params,
                package_dir=package_dir,
                model=model,
                spec=spec,
            )
        else:
            export = getattr(obj, "export", None)
            if not callable(export):
                raise GenerationError(
                    f"{spec.id} dataset returned {type(obj).__name__}, which cannot "
                    "be exported as a Dataset Manifest v2 package"
                )
            export(package_dir, format=spec.export.format)
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
        artifact_names = [path.relative_to(package_dir).as_posix() for path in artifact_paths]
        _write_package_archive(package_dir, archive_path=archive_path)

    dataset_key = f"{model.catalog.dataset_key_prefix}-{spec.dataset_key_suffix}"
    return {
        "id": spec.id,
        "dataset": spec.dataset,
        "dataset_key": dataset_key,
        "package_format": "dtccpkg",
        "package_path": str(archive_path),
        "archive_path": str(archive_path),
        "manifest": "manifest.json",
        "artifacts": artifact_names,
        "publish_requested": spec.table.publish,
        "table_role": spec.table.role,
        "tier": spec.table.tier,
    }


def _export_serialized_payload_package(
    payload: bytes | bytearray | str,
    *,
    dataset: DatasetFactory,
    params: Mapping[str, Any],
    package_dir: Path,
    model: TableModelSpec,
    spec: TableDatasetSpec,
) -> None:
    validate = getattr(dataset, "validate", None)
    create_context = getattr(dataset, "create_context", None)
    if not callable(validate) or not callable(create_context):
        raise GenerationError(
            f"{spec.id} returned serialized {type(payload).__name__} data, but "
            "the dataset does not expose validate/create_context for manifest generation"
        )

    args = validate(dict(params))
    context = create_context(args)

    artifact_dir = package_dir / "artifacts"
    artifact_dir.mkdir(parents=True, exist_ok=False)
    artifact_path = artifact_dir / spec.export.filename
    if isinstance(payload, str):
        artifact_path.write_text(payload, encoding="utf-8")
    else:
        artifact_path.write_bytes(bytes(payload))

    from dtcc_core.datasets.schema import DatasetArtifact

    artifact = DatasetArtifact(
        path=artifact_path.relative_to(package_dir).as_posix(),
        role="primary",
        format=spec.export.format,
        media_type=spec.export.media_type,
        data_kind=spec.export.data_kind,
        crs=spec.export.crs,
        bounds=list(model.bounds),
        size=artifact_path.stat().st_size,
        sha256=_sha256_file(artifact_path),
    )
    manifest = context.manifest(artifacts=[artifact]).model_dump(mode="json")
    _write_json(package_dir / "manifest.json", manifest)


def _export_plot_media_package(
    obj,
    *,
    package_dir: Path,
    model: TableModelSpec,
    spec: TableDatasetSpec,
) -> None:
    if spec.export.format != "png":
        raise GenerationError(
            f"{spec.id} export.renderer='plot' only supports format='png'"
        )
    context = getattr(obj, "dataset_context", None)
    if context is None:
        raise GenerationError(
            f"{spec.id} cannot render a plot package because the dataset result "
            "has no DatasetContext."
        )

    artifact_dir = package_dir / "artifacts"
    artifact_dir.mkdir(parents=True, exist_ok=False)
    artifact_path = artifact_dir / spec.export.filename
    _write_plot_png(obj, artifact_path, model=model, spec=spec)
    _write_media_manifest(obj, artifact_path, model=model, spec=spec)


def _export_mesh_topdown_package(
    obj,
    *,
    package_dir: Path,
    model: TableModelSpec,
    spec: TableDatasetSpec,
) -> None:
    if spec.export.format != "png":
        raise GenerationError(
            f"{spec.id} export.renderer='mesh_topdown' only supports format='png'"
        )
    context = getattr(obj, "dataset_context", None)
    if context is None:
        raise GenerationError(
            f"{spec.id} cannot render a mesh package because the dataset result "
            "has no DatasetContext."
        )

    artifact_dir = package_dir / "artifacts"
    artifact_dir.mkdir(parents=True, exist_ok=False)
    artifact_path = artifact_dir / spec.export.filename
    _write_mesh_topdown_png(obj, artifact_path, model=model, spec=spec)
    _write_media_manifest(obj, artifact_path, model=model, spec=spec)


def _write_media_manifest(
    obj,
    artifact_path: Path,
    *,
    model: TableModelSpec,
    spec: TableDatasetSpec,
) -> None:
    from dtcc_core.datasets.schema import DatasetArtifact

    package_dir = artifact_path.parent.parent
    artifact = DatasetArtifact(
        path=artifact_path.relative_to(package_dir).as_posix(),
        role="primary",
        format=spec.export.format,
        media_type=spec.export.media_type,
        data_kind=spec.export.data_kind,
        crs=spec.export.crs,
        bounds=list(model.bounds),
        size=artifact_path.stat().st_size,
        sha256=_sha256_file(artifact_path),
    )
    manifest = obj.dataset_context.manifest(artifacts=[artifact]).model_dump(mode="json")
    _write_json(package_dir / "manifest.json", manifest)


def _write_plot_png(
    obj,
    path: Path,
    *,
    model: TableModelSpec,
    spec: TableDatasetSpec,
) -> None:
    _ensure_mpl_config_dir()
    from matplotlib.backends.backend_agg import FigureCanvasAgg
    from matplotlib.figure import Figure

    figure = Figure(
        figsize=(spec.export.width_px / spec.export.dpi, spec.export.height_px / spec.export.dpi),
        dpi=spec.export.dpi,
        facecolor="#101214",
    )
    FigureCanvasAgg(figure)
    ax = figure.add_axes([0, 0, 1, 1])
    ax.set_facecolor("#101214")

    plot = getattr(obj, "plot", None)
    if not callable(plot):
        raise GenerationError(f"{spec.id} result has no plot() method for PNG export")
    plot_kwargs = copy.deepcopy(spec.export.plot)
    plot_kwargs.setdefault("presentation", False)
    plot_kwargs.setdefault("show", False)
    plot_kwargs.setdefault("theme", "dark")
    plot_kwargs.setdefault("ax", ax)
    plot(**plot_kwargs)
    _strip_table_plot_chrome(figure, ax, model.bounds)
    figure.savefig(
        path,
        format="png",
        dpi=spec.export.dpi,
        facecolor=figure.get_facecolor(),
        edgecolor="none",
    )


def _write_mesh_topdown_png(
    obj,
    path: Path,
    *,
    model: TableModelSpec,
    spec: TableDatasetSpec,
) -> None:
    _ensure_mpl_config_dir()
    import numpy as np
    from matplotlib.backends.backend_agg import FigureCanvasAgg
    from matplotlib.collections import PolyCollection
    from matplotlib.figure import Figure

    vertices = np.asarray(getattr(obj, "vertices", []), dtype=float)
    faces = np.asarray(getattr(obj, "faces", []), dtype=int)
    if vertices.ndim != 2 or vertices.shape[1] < 2:
        raise GenerationError(f"{spec.id} mesh result has invalid vertices")
    if faces.ndim != 2 or faces.shape[1] < 3:
        raise GenerationError(f"{spec.id} mesh result has invalid faces")

    figure = Figure(
        figsize=(spec.export.width_px / spec.export.dpi, spec.export.height_px / spec.export.dpi),
        dpi=spec.export.dpi,
        facecolor="#101214",
    )
    FigureCanvasAgg(figure)
    ax = figure.add_axes([0, 0, 1, 1])
    ax.set_facecolor("#101214")

    polygons = vertices[faces[:, :3], :2]
    z_values = vertices[faces[:, :3], 2].mean(axis=1) if vertices.shape[1] >= 3 else None
    collection = PolyCollection(
        polygons,
        edgecolors="#263236",
        linewidths=0.12,
        closed=True,
    )
    if z_values is None:
        collection.set_facecolor("#7fc7bd")
    else:
        collection.set_array(z_values)
        collection.set_cmap("viridis")
    ax.add_collection(collection)
    _strip_table_plot_chrome(figure, ax, model.bounds)
    figure.savefig(
        path,
        format="png",
        dpi=spec.export.dpi,
        facecolor=figure.get_facecolor(),
        edgecolor="none",
    )


def _strip_table_plot_chrome(figure, ax, bounds: tuple[float, float, float, float]) -> None:
    for other_ax in list(figure.axes):
        if other_ax is not ax:
            figure.delaxes(other_ax)
    legend = ax.get_legend()
    if legend is not None:
        legend.remove()
    for text in list(ax.texts):
        text.set_visible(False)
    ax.set_title("")
    ax.set_xlim(bounds[0], bounds[2])
    ax.set_ylim(bounds[1], bounds[3])
    ax.set_aspect("equal", adjustable="box")
    ax.set_axis_off()
    figure.subplots_adjust(left=0, right=1, bottom=0, top=1)


def _write_package_archive(package_dir: Path, *, archive_path: Path) -> Path:
    if archive_path.exists():
        raise GenerationError(f"Dataset package archive already exists: {archive_path}")
    with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for file_path in sorted(path for path in package_dir.rglob("*") if path.is_file()):
            archive.write(file_path, file_path.relative_to(package_dir).as_posix())
    return archive_path


def _ensure_mpl_config_dir() -> None:
    if os.environ.get("MPLCONFIGDIR"):
        return
    path = Path(os.environ.get("TMPDIR") or "/tmp") / "dtcc-table-matplotlib"
    path.mkdir(parents=True, exist_ok=True)
    os.environ["MPLCONFIGDIR"] = str(path)


def _import_required_modules(module_names: Sequence[str]) -> None:
    for module_name in module_names:
        importlib.import_module(module_name)


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

    archive_path = Path(str(generated["archive_path"]))
    if not archive_path.is_file():
        raise GenerationError(f"Generated .dtccpkg does not exist: {archive_path}")
    with tempfile.TemporaryDirectory(prefix="dtcc-publish-") as tmpdir:
        package_dir = Path(tmpdir) / _safe_archive_stem(archive_path.stem)
        _extract_package_archive(archive_path, package_dir)
        manifest_path = package_dir / "manifest.json"
        manifest = _read_json_manifest(manifest_path)
        artifact_paths = _artifact_paths_from_manifest(package_dir, manifest)
        client = DatasetUploadClient.from_config(upload_url=upload_url, token=token)
        publication = client.upload_package(
            dataset_key=dataset_key,
            manifest_path=manifest_path,
            files=artifact_paths,
            manifest=manifest,
        )
    return {
        "id": generated["id"],
        "dataset_key": publication.dataset_key,
        "version_number": publication.version_number,
    }


def _extract_package_archive(archive_path: Path, package_dir: Path) -> None:
    package_dir.mkdir(parents=True, exist_ok=False)
    with zipfile.ZipFile(archive_path) as archive:
        members = archive.infolist()
        if not any(member.filename == "manifest.json" and not member.is_dir() for member in members):
            raise GenerationError(f"{archive_path} is missing manifest.json")
        for member in members:
            if member.is_dir():
                continue
            if not _safe_relative_path(member.filename):
                raise GenerationError(
                    f"{archive_path} contains unsafe member {member.filename!r}"
                )
            target = package_dir / member.filename
            target.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(member) as source, target.open("wb") as destination:
                shutil.copyfileobj(source, destination)


def _artifact_paths_from_manifest(package_dir: Path, manifest: Mapping[str, Any]) -> tuple[Path, ...]:
    artifacts = manifest.get("artifacts")
    if not isinstance(artifacts, list) or not artifacts:
        raise GenerationError("Dataset Manifest v2 must contain non-empty artifacts")
    paths = []
    for index, artifact in enumerate(artifacts):
        if not isinstance(artifact, dict):
            raise GenerationError(f"Dataset Manifest v2 artifact {index} must be an object")
        path_value = artifact.get("path")
        if not isinstance(path_value, str):
            raise GenerationError(f"Dataset Manifest v2 artifact {index} must include path")
        artifact_path = _resolve_package_path(package_dir, path_value)
        if not artifact_path.is_file():
            raise GenerationError(f"Dataset Manifest v2 references missing artifact {path_value}")
        paths.append(artifact_path)
    return tuple(paths)


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
        "tier": spec.table.tier,
        "reason": spec.table.reason,
        "dataset_key": f"{model.catalog.dataset_key_prefix}-{spec.dataset_key_suffix}",
        "format": spec.export.format,
        "filename": spec.export.filename,
        "table_role": spec.table.role,
        "publish_requested": spec.table.publish,
        "requires_network": spec.table.requires_network,
        "required_env": list(spec.table.required_env),
        "required_python": list(spec.table.required_python),
        "skip_reason": spec.table.skip_reason,
        "media_type": spec.export.media_type,
        "data_kind": spec.export.data_kind,
        "crs": spec.export.crs,
    }


def _report_skipped_item(spec: TableDatasetSpec, reason: str) -> dict[str, str]:
    item = {
        "id": spec.id,
        "tier": spec.table.tier,
        "reason": reason,
        "table_reason": spec.table.reason,
    }
    if spec.table.skip_reason:
        item["skip_reason"] = spec.table.skip_reason
    return item


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


def _optional_str_tuple(data: Mapping[str, Any], key: str, where: str) -> tuple[str, ...]:
    if key not in data or data[key] is None:
        return ()
    value = data[key]
    if isinstance(value, str):
        items = [value]
    elif isinstance(value, list):
        items = value
    else:
        raise SpecError(f"{where}.{key} must be a string or list of strings")
    result = []
    for index, item in enumerate(items):
        if not isinstance(item, str) or not item.strip():
            raise SpecError(f"{where}.{key}[{index}] must be a non-empty string")
        result.append(item.strip())
    return tuple(result)


def _optional_mapping(data: Mapping[str, Any], key: str, where: str) -> dict[str, Any]:
    if key not in data or data[key] is None:
        return {}
    value = data[key]
    if not isinstance(value, dict):
        raise SpecError(f"{where}.{key} must be a mapping")
    return dict(value)


def _optional_positive_int(
    data: Mapping[str, Any],
    key: str,
    default: int,
    where: str,
) -> int:
    if key not in data or data[key] is None:
        return default
    value = data[key]
    if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
        raise SpecError(f"{where}.{key} must be a positive integer")
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


def _safe_archive_stem(value: str) -> str:
    stem = str(value).strip().replace(" ", "_").replace("-", "_").lower()
    sanitized = "".join(char if char.isalnum() or char == "_" else "_" for char in stem)
    while "__" in sanitized:
        sanitized = sanitized.replace("__", "_")
    return sanitized.strip("_") or "dataset_package"


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
  python scripts/generate_table_catalog.py gbg_500m_2026_07 --include dev --clean
  python scripts/generate_table_catalog.py gbg_500m_2026_07 --include credentialed --strict --dry-run
  python scripts/generate_table_catalog.py gbg_500m_2026_07 --include simulation --dry-run
  python scripts/generate_table_catalog.py gbg_500m_2026_07 --include expensive --run-expensive --clean
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
    parser.add_argument("--include", action="append", default=[], metavar="SET", help="Include default, dev, credentialed, simulation, expensive, or all. May be repeated or comma-separated. Default: default.")
    parser.add_argument("--tier", action="append", default=[], metavar="SET", help="Legacy alias for --include.")
    parser.add_argument("--only", action="append", default=[], metavar="ID", help="Generate only one dataset id. May be repeated.")
    parser.add_argument("--skip", action="append", default=[], metavar="ID", help="Skip one dataset id. May be repeated.")
    parser.add_argument("--clean", action="store_true", help="Delete an existing non-empty output directory before generation.")
    parser.add_argument("--dry-run", action="store_true", help="Validate specs and print the planned actions without running datasets.")
    parser.add_argument("--strict", action="store_true", help="Fail instead of skipping selected entries with missing dependencies or credentials.")
    parser.add_argument("--run-expensive", action="store_true", help="Allow selected expensive-tier entries to run.")
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
            include=args.include,
            tier=args.tier,
            only=args.only,
            skip=args.skip,
            clean=args.clean,
            dry_run=args.dry_run,
            strict=args.strict,
            run_expensive=args.run_expensive,
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
