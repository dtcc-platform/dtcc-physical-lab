from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

from scripts.generate_table_catalog import GenerationError, generate_catalog


REPO_ROOT = Path(__file__).resolve().parents[1]


def _write_fake_specs(root: Path, *, output_dir: str = "temp/fake") -> None:
    model_dir = root / "table_models" / "fake_model"
    model_dir.mkdir(parents=True)
    (model_dir / "model.yaml").write_text(
        "\n".join(
            [
                "model_id: fake_model",
                "title: Fake model",
                "crs: EPSG:3006",
                "bounds: [10, 20, 30, 40]",
                "physical:",
                "  width_mm: 20",
                "  height_mm: 20",
                "  scale: 1000",
                "catalog:",
                "  dataset_key_prefix: fake-prefix",
                f"  output_dir: {output_dir}",
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    (model_dir / "datasets.yaml").write_text(
        "\n".join(
            [
                "datasets:",
                "  - id: fake_geojson",
                "    dataset: fake_dataset",
                "    title: Fake GeoJSON",
                "    description: Fake generated package.",
                "    params:",
                "      answer: 42",
                "    export:",
                "      format: geojson",
                "      filename: fake.geojson",
                "      media_type: application/geo+json",
                "      data_kind: vector",
                "      crs: EPSG:3006",
                "    table:",
                "      role: overlay",
                "      dataset_key_suffix: fake-geojson",
                "      publish: true",
            ]
        )
        + "\n",
        encoding="utf-8",
    )


class FakeDatasetObject:
    def __init__(self, params):
        self.params = params

    def export(self, package_dir: Path, *, format: str):
        package_dir.mkdir(parents=True)
        artifact_dir = package_dir / "artifacts"
        artifact_dir.mkdir()
        artifact_path = artifact_dir / "generated.geojson"
        artifact_path.write_text(
            '{"type":"FeatureCollection","features":[]}\n',
            encoding="utf-8",
        )
        payload = artifact_path.read_bytes()
        manifest = {
            "schema_version": "dtcc-dataset-manifest-v2",
            "identity": {"name": "fake_dataset", "title": "Original title"},
            "metadata": {"description": "Original description"},
            "provenance": {},
            "presentation": {"summary": "Original summary"},
            "request": {
                "dataset_name": "fake_dataset",
                "parameters": dict(self.params),
                "bounds": self.params["bounds"],
            },
            "artifacts": [
                {
                    "path": "artifacts/generated.geojson",
                    "role": "primary",
                    "format": format,
                    "media_type": "application/geo+json",
                    "data_kind": "vector",
                    "crs": "EPSG:3006",
                    "bounds": self.params["bounds"],
                    "size": len(payload),
                    "sha256": hashlib.sha256(payload).hexdigest(),
                }
            ],
        }
        (package_dir / "manifest.json").write_text(
            json.dumps(manifest, indent=2) + "\n",
            encoding="utf-8",
        )


def fake_dataset(**params):
    return FakeDatasetObject(params)


class WrongMediaTypeDatasetObject(FakeDatasetObject):
    def export(self, package_dir: Path, *, format: str):
        super().export(package_dir, format=format)
        manifest_path = package_dir / "manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest["artifacts"][0]["media_type"] = "application/json"
        manifest_path.write_text(
            json.dumps(manifest, indent=2) + "\n",
            encoding="utf-8",
        )


def wrong_media_type_dataset(**params):
    return WrongMediaTypeDatasetObject(params)


def test_dry_run_validates_real_specs_without_creating_output(tmp_path):
    output_dir = tmp_path / "dry-run-output"

    report = generate_catalog(
        "gbg_500m_2026_07",
        root_dir=REPO_ROOT,
        output_dir=output_dir,
        dry_run=True,
    )

    assert output_dir.exists() is False
    assert report["dry_run"] is True
    assert {item["id"] for item in report["planned"]} >= {
        "calibration_grid",
        "smoke_slice",
        "smoke_streamlines",
    }
    planned_by_id = {item["id"]: item for item in report["planned"]}
    assert planned_by_id["calibration_grid"]["media_type"] == (
        "application/geo+json"
    )
    assert planned_by_id["calibration_grid"]["crs"] == "EPSG:3006"
    assert planned_by_id["smoke_slice"]["media_type"] == "image/png"
    assert {item["id"] for item in report["skipped"]} >= {
        "smoke_field_vtu",
        "smoke_field_pb",
        "smoke_streamlines_mp4",
        "footprints_geojson",
    }


def test_publish_requires_configuration_before_dry_run():
    with pytest.raises(GenerationError, match="DTCC_UPLOAD_URL"):
        generate_catalog(
            "gbg_500m_2026_07",
            root_dir=REPO_ROOT,
            dry_run=True,
            publish=True,
            env={},
        )


def test_non_empty_output_requires_clean(tmp_path):
    _write_fake_specs(tmp_path, output_dir="out")
    output_dir = tmp_path / "out"
    output_dir.mkdir()
    (output_dir / "existing.txt").write_text("keep\n", encoding="utf-8")

    with pytest.raises(GenerationError, match="Pass --clean"):
        generate_catalog(
            "fake_model",
            root_dir=tmp_path,
            dataset_registry={"fake_dataset": fake_dataset},
        )


def test_fake_dataset_generation_writes_valid_package(tmp_path):
    _write_fake_specs(tmp_path, output_dir="out")

    report = generate_catalog(
        "fake_model",
        root_dir=tmp_path,
        clean=True,
        dataset_registry={"fake_dataset": fake_dataset},
    )

    assert len(report["generated"]) == 1
    generated = report["generated"][0]
    assert generated["dataset_key"] == "fake-prefix-fake-geojson"

    package_dir = Path(generated["package_dir"])
    manifest = json.loads((package_dir / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["identity"]["title"] == "Fake GeoJSON"
    assert manifest["metadata"]["description"] == "Fake generated package."
    assert manifest["request"]["bounds"] == [10.0, 20.0, 30.0, 40.0]
    assert manifest["artifacts"][0]["path"] == "artifacts/fake.geojson"
    assert manifest["artifacts"][0]["media_type"] == "application/geo+json"
    assert manifest["artifacts"][0]["data_kind"] == "vector"
    assert manifest["artifacts"][0]["crs"] == "EPSG:3006"
    assert manifest["presentation"]["view_hints"]["expected_format"] == "geojson"
    assert manifest["presentation"]["view_hints"]["expected_crs"] == "EPSG:3006"
    assert (package_dir / "artifacts" / "fake.geojson").is_file()
    assert (package_dir / "generation_report.json").exists() is False
    assert (tmp_path / "out" / "generation_report.json").is_file()


def test_generation_fails_when_artifact_metadata_mismatches_spec(tmp_path):
    _write_fake_specs(tmp_path, output_dir="out")

    with pytest.raises(GenerationError, match="media_type"):
        generate_catalog(
            "fake_model",
            root_dir=tmp_path,
            clean=True,
            dataset_registry={"fake_dataset": wrong_media_type_dataset},
        )
