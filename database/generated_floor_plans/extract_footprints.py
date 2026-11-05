"""Extract original-resolution building masks from the supplied raster references.

Run with Python plus Pillow and numpy. No smoothing, resizing, or polygon fitting
is performed: exterior pixels are selected by the documented navy threshold.
"""

import argparse
from collections import deque
import json
from pathlib import Path
import shutil

import numpy as np
from PIL import Image, ImageDraw


ATTACHMENTS = Path("C:/Users/sortiz/.t3/userdata/attachments")
PREFIX = "c421cf06-02b7-426e-96c1-e1de5d82569d-"
BUILDINGS = [
    ("mccarthy_hall", "McCarthy Hall", "3c7bfdac-b7b1-46de-9564-7ca8f2ef03ee"),
    ("education_classroom", "Education Classroom", "3182101c-2a7d-4dec-ab7b-554645b4d7d4"),
    ("engineering", "Engineering", "5737f4b8-d81e-4859-a14e-ab23bc13a3ad"),
    ("computer_science", "Computer Science", "04b618eb-7c02-4294-ba88-218d317cfea0"),
    ("humanities", "Humanities", "559fc5b3-0637-4ebd-8f00-609dbc499a4e"),
]
NAVY_THRESHOLD = {
    "color_space": "RGB, 8-bit channels",
    "expression": "R <= 135 and G <= 155 and B <= 185 and B-R >= 18 and G-R >= 4",
    "reason": "Includes navy edge antialiasing; excludes neutral text/checkerboard and green patches.",
}


def components(binary):
    """Return 4-connected components as flat pixel indices, largest first."""
    height, width = binary.shape
    remaining = binary.copy().ravel()
    groups = []
    for seed in np.flatnonzero(remaining):
        if not remaining[seed]:
            continue
        remaining[seed] = False
        pending = deque([int(seed)])
        group = []
        while pending:
            index = pending.popleft()
            group.append(index)
            y, x = divmod(index, width)
            neighbors = []
            if x:
                neighbors.append(index - 1)
            if x + 1 < width:
                neighbors.append(index + 1)
            if y:
                neighbors.append(index - width)
            if y + 1 < height:
                neighbors.append(index + width)
            for neighbor in neighbors:
                if remaining[neighbor]:
                    remaining[neighbor] = False
                    pending.append(neighbor)
        groups.append(group)
    return sorted(groups, key=len, reverse=True)


def extract(image):
    rgb = np.asarray(image.convert("RGB"), dtype=np.int16)
    red, green, blue = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    thresholded = ((red <= 135) & (green <= 155) & (blue <= 185)
                   & (blue - red >= 18) & (green - red >= 4))
    groups = components(thresholded)
    if not groups:
        raise ValueError("No navy building component found")
    building = np.zeros(thresholded.shape, dtype=bool)
    building.ravel()[groups[0]] = True

    # Padding guarantees that the seed is exterior, even for edge-touching art.
    # Copy detaches Pillow's read-only numpy buffer before floodfill mutates it.
    padded = Image.fromarray(np.pad(building.astype(np.uint8) * 255, 1)).copy()
    ImageDraw.floodfill(padded, (0, 0), 128, thresh=0)
    holes = np.asarray(padded)[1:-1, 1:-1] == 0
    filled = building | holes
    mask = Image.fromarray(filled.astype(np.uint8) * 255)
    return mask, {
        "threshold_pixel_count": int(thresholded.sum()),
        "navy_component_count": len(groups),
        "discarded_component_pixel_count": int(thresholded.sum() - building.sum()),
        "navy_building_pixel_count": int(building.sum()),
        "holes_filled": len(components(holes)),
        "hole_pixels_filled": int(holes.sum()),
        "mask_pixel_count": int(filled.sum()),
        "bbox": list(mask.getbbox()),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path, default=ATTACHMENTS)
    parser.add_argument("--output-dir", type=Path, default=Path(__file__).resolve().parent)
    args = parser.parse_args()
    for folder in ("references", "masks", "review"):
        (args.output_dir / folder).mkdir(parents=True, exist_ok=True)
    report = {
        "schema_version": 1,
        "navy_threshold": NAVY_THRESHOLD,
        "mask_format": "PNG, mode L, original source resolution; outside 0, inside 255",
        "bbox_convention": "[left, top, right, bottom], right and bottom exclusive",
        "method": "Keep largest 4-connected navy component; flood-fill exterior from padded image border; fill all enclosed non-navy holes. No dilation, erosion, smoothing, or resizing.",
        "limitations": [
            "Binary raster edges use the stated threshold; antialiased source pixels have no unique binary boundary or recoverable vector outline.",
            "All enclosed holes are filled, including white lettering. These source silhouettes do not establish real interior courtyards or floor layouts.",
            "Masks reproduce supplied illustrations, not verified building surveys or real campus floor plans.",
        ],
        "buildings": [],
    }
    for building_id, name, attachment_id in BUILDINGS:
        source = args.source_dir / (PREFIX + attachment_id + ".png")
        reference = args.output_dir / "references" / (building_id + ".png")
        if source.resolve() != reference.resolve():
            shutil.copyfile(source, reference)
        with Image.open(reference) as image:
            source_size = list(image.size)
            mask, counts = extract(image)
        mask_path = args.output_dir / "masks" / (building_id + ".png")
        mask.save(mask_path)
        with Image.open(mask_path) as saved:
            assert saved.mode == "L" and list(saved.size) == source_size
            assert set(np.unique(np.asarray(saved))) <= {0, 255}
        notes = []
        if building_id == "mccarthy_hall":
            notes.append("Thin bottom-right horizontal spur is connected navy source artwork and is preserved. It appears to be a possible drawing/export artifact; its architectural meaning cannot be verified.")
        elif building_id == "engineering":
            notes.append("Small right-edge step is retained at original pixel coordinates.")
        elif building_id == "computer_science":
            notes.append("Exterior-connected top and bottom notches are retained, not filled as lettering holes.")
        elif building_id == "education_classroom":
            notes.append("Exterior-connected slots, stepped lower edge, and irregular upper outline are retained; green patch is excluded.")
        elif building_id == "humanities":
            notes.append("Left recess and right-edge steps are retained; detached green patches are excluded.")
        entry = {
            "id": building_id, "name": name, "source": str(source),
            "reference": "references/" + reference.name,
            "mask": "masks/" + mask_path.name,
            "source_size": source_size, **counts, "limitations": notes,
        }
        report["buildings"].append(entry)
        print(f"{name}: {source_size}, bbox={counts['bbox']}, pixels={counts['mask_pixel_count']}, holes={counts['holes_filled']}")
    (args.output_dir / "review" / "footprints.json").write_text(
        json.dumps(report, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
