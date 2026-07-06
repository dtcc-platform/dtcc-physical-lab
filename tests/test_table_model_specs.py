from __future__ import annotations

from pathlib import Path

import pytest

from scripts.generate_table_catalog import SpecError, load_specs


REPO_ROOT = Path(__file__).resolve().parents[1]


def test_gbg_table_model_specs_validate():
    model, datasets = load_specs(REPO_ROOT, "gbg_500m_2026_07")

    assert model.model_id == "gbg_500m_2026_07"
    assert model.crs == "EPSG:3006"
    assert model.bounds == (319720.0, 6397660.0, 320220.0, 6398160.0)
    assert model.physical.width_mm == 400
    assert model.physical.height_mm == 400
    assert model.physical.scale == 1250

    ids = {spec.id for spec in datasets}
    assert {
        "calibration_grid",
        "smoke_field_vtu",
        "smoke_field_pb",
        "smoke_slice_geojson",
        "smoke_streamlines_geojson",
        "smoke_slice",
        "smoke_streamlines",
        "smoke_streamlines_mp4",
        "footprints_geojson",
    } <= ids

    by_id = {spec.id: spec for spec in datasets}
    assert "12.5 m coordinate grid" in by_id["calibration_grid"].description
    assert by_id["calibration_grid"].export.media_type == "application/geo+json"
    assert by_id["calibration_grid"].export.data_kind == "vector"
    assert by_id["calibration_grid"].export.crs == "EPSG:3006"
    assert by_id["smoke_slice"].export.media_type == "image/png"
    assert by_id["smoke_slice"].export.data_kind == "raster"
    assert by_id["smoke_slice"].export.crs == "EPSG:3006"
    assert by_id["smoke_slice_geojson"].export.crs == "EPSG:3006"
    assert "not validated CFD" in by_id["smoke_slice"].description
    assert "not validated CFD" in by_id["smoke_streamlines"].description
    assert "source and license review" in by_id["footprints_geojson"].description
    assert by_id["footprints_geojson"].params["source"] == "LM"
    assert by_id["footprints_geojson"].table.role == "alignment_context"
    assert by_id["footprints_geojson"].export.crs == "EPSG:3006"


def test_default_disabled_specs_have_reasons():
    _model, datasets = load_specs(REPO_ROOT, "gbg_500m_2026_07")

    disabled = [spec for spec in datasets if not spec.table.default_enabled]

    assert {spec.id for spec in disabled} == {
        "smoke_field_vtu",
        "smoke_field_pb",
        "smoke_streamlines_mp4",
        "footprints_geojson",
    }
    assert all(spec.table.skip_reason for spec in disabled)


def test_gbg_table_profile_readme_documents_operations():
    readme = (
        REPO_ROOT / "table_models" / "gbg_500m_2026_07" / "README.md"
    ).read_text(encoding="utf-8")

    assert "Bounds: `[319720, 6397660, 320220, 6398160]`" in readme
    assert "python scripts/generate_table_catalog.py gbg_500m_2026_07 --dry-run" in (
        readme
    )
    assert "python scripts/generate_table_catalog.py gbg_500m_2026_07 --clean" in (
        readme
    )
    assert "DTCC_UPLOAD_URL" in readme
    assert "smoke_field_vtu" in readme
    assert "footprints_geojson" in readme
    assert "Visual Inspection Notes" in readme


def test_model_id_must_match_directory(tmp_path):
    model_dir = tmp_path / "table_models" / "bad_model"
    model_dir.mkdir(parents=True)
    (model_dir / "model.yaml").write_text(
        "\n".join(
            [
                "model_id: other",
                "title: Bad",
                "crs: EPSG:3006",
                "bounds: [0, 0, 1, 1]",
                "physical:",
                "  width_mm: 1",
                "  height_mm: 1",
                "  scale: 1",
                "catalog:",
                "  dataset_key_prefix: bad",
                "  output_dir: temp/bad",
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    (model_dir / "datasets.yaml").write_text("datasets: []\n", encoding="utf-8")

    with pytest.raises(SpecError, match="does not match requested model_id"):
        load_specs(tmp_path, "bad_model")


def test_dataset_spec_cannot_override_model_bounds(tmp_path):
    model_dir = tmp_path / "table_models" / "bad_model"
    model_dir.mkdir(parents=True)
    (model_dir / "model.yaml").write_text(
        "\n".join(
            [
                "model_id: bad_model",
                "title: Bad",
                "crs: EPSG:3006",
                "bounds: [0, 0, 1, 1]",
                "physical:",
                "  width_mm: 1",
                "  height_mm: 1",
                "  scale: 1",
                "catalog:",
                "  dataset_key_prefix: bad",
                "  output_dir: temp/bad",
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    (model_dir / "datasets.yaml").write_text(
        "\n".join(
            [
                "datasets:",
                "  - id: bad",
                "    dataset: fake",
                "    title: Bad",
                "    description: Bad",
                "    params:",
                "      bounds: [1, 1, 2, 2]",
                "    export:",
                "      format: geojson",
                "      filename: bad.geojson",
                "    table:",
                "      role: overlay",
            ]
        )
        + "\n",
        encoding="utf-8",
    )

    with pytest.raises(SpecError, match="must not contain bounds"):
        load_specs(tmp_path, "bad_model")
