"""Build the stimulus pool + trials.csv for the pairwise similarity-rating
pretest, from the completed manual screening pass.

Selection rules (per user spec):
  - screening_score == 100  -> always kept (guaranteed baseline)
  - screening_score == 80   -> kept in full (small pool, ~18 rows)
  - screening_score == 50   -> selectively added ONLY to fill visual/graph
                                similarity-score bins that are underrepresented
                                in the 100+80 baseline, so the final pool
                                covers a wide similarity range rather than
                                clustering at the extremes
  - screening_score == 20 / Reject -> always excluded

Also: excludes pairs with missing image files, drops duplicate/A-B-swapped
pairs, and caps how often any single image can appear (the cap only
constrains which score-50 pairs get ADDED — the 100/80 baseline is never
dropped for occurrence reasons, per "100 must always be kept").

Usage:
    cd "shophouse genomics"
    python3 similarity_rating_pretest/build_pool.py
"""
import argparse
import csv
import random
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULT_CANDIDATE_PAIRS = HERE.parent / "behavioral_pretest" / "candidate_pairs.csv"
DEFAULT_SCREENING_RESULTS = HERE.parent / "behavioral_pretest" / "manual_screening_results.csv"
DEFAULT_SOURCE_IMAGES = HERE.parent / "behavioral_pretest" / "images"
OUT_TRIALS = HERE / "trials.csv"
OUT_SUMMARY = HERE / "trials_summary.csv"
OUT_IMAGES_DIR = HERE / "images"

TRIALS_COLUMNS = [
    "trial_id", "condition", "image_A", "image_B",
    "visual_A", "visual_B", "graph_A", "graph_B",
    "visual_similarity_score", "graph_similarity_score", "screening_score",
]


def load_merged_rows(screening_csv, candidate_pairs_csv):
    scores_by_pair = {}
    with open(candidate_pairs_csv, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            scores_by_pair[row["pair_id"]] = (
                row["visual_similarity_score"], row["graph_similarity_score"]
            )

    rows = []
    with open(screening_csv, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            vs, gs = scores_by_pair.get(row["pair_id"], (None, None))
            row["visual_similarity_score"] = vs
            row["graph_similarity_score"] = gs
            rows.append(row)
    return rows


def pair_key(row):
    return tuple(sorted([row["image_A"], row["image_B"]]))


def dedupe(rows):
    seen, kept = set(), []
    for row in rows:
        key = pair_key(row)
        if key in seen:
            continue
        seen.add(key)
        kept.append(row)
    return kept, len(rows) - len(kept)


def filter_existing_images(rows, images_dir):
    existing = {p.name for p in images_dir.iterdir() if p.is_file()}
    kept, missing = [], []
    for row in rows:
        if row["image_A"] in existing and row["image_B"] in existing:
            kept.append(row)
        else:
            missing.append(row)
    return kept, missing


def screening_score_of(row):
    try:
        return int(float(row["screening_score"]))
    except (ValueError, TypeError):
        return None


def quantile_bin_edges(values, n_bins):
    values = sorted(values)
    edges = []
    for i in range(1, n_bins):
        idx = int(len(values) * i / n_bins)
        idx = min(idx, len(values) - 1)
        edges.append(values[idx])
    return edges


def bin_of(value, edges):
    for i, edge in enumerate(edges):
        if value <= edge:
            return i
    return len(edges)


def select_pool50_for_coverage(pool50, baseline_bin_counts, image_count,
                                visual_edges, graph_edges,
                                max_image_occurrence, target_min_per_bin, seed):
    rng = random.Random(seed)
    candidates = pool50[:]
    rng.shuffle(candidates)

    vis_counts = Counter(baseline_bin_counts["visual"])
    graph_counts = Counter(baseline_bin_counts["graph"])
    added = []

    def priority(row):
        vb = bin_of(float(row["visual_similarity_score"]), visual_edges)
        gb = bin_of(float(row["graph_similarity_score"]), graph_edges)
        return (1.0 / (1 + vis_counts[vb])) + (1.0 / (1 + graph_counts[gb])), vb, gb

    remaining = candidates
    while remaining:
        scored = [(priority(r), r) for r in remaining]
        scored.sort(key=lambda x: x[0][0], reverse=True)
        (best_priority, vb, gb), best_row = scored[0]

        bins_already_full = (vis_counts[vb] >= target_min_per_bin and
                              graph_counts[gb] >= target_min_per_bin)
        if bins_already_full:
            break

        a, b = best_row["image_A"], best_row["image_B"]
        if image_count[a] >= max_image_occurrence or image_count[b] >= max_image_occurrence:
            remaining = [r for r in remaining if r is not best_row]
            continue

        added.append(best_row)
        image_count[a] += 1
        image_count[b] += 1
        vis_counts[vb] += 1
        graph_counts[gb] += 1
        remaining = [r for r in remaining if r is not best_row]

    return added


def jpg_name(original_name):
    return str(Path(original_name).with_suffix(".jpg"))


def write_trials_csv(rows, out_path):
    with open(out_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=TRIALS_COLUMNS)
        writer.writeheader()
        for row in rows:
            writer.writerow({
                "trial_id": row["pair_id"],
                "condition": row["condition"],
                "image_A": jpg_name(row["image_A"]),
                "image_B": jpg_name(row["image_B"]),
                "visual_A": row["visual_A"],
                "visual_B": row["visual_B"],
                "graph_A": row["graph_A"],
                "graph_B": row["graph_B"],
                "visual_similarity_score": row["visual_similarity_score"],
                "graph_similarity_score": row["graph_similarity_score"],
                "screening_score": row["screening_score"],
            })


def sync_images_folder(rows, source_images_dir, out_images_dir):
    needed = set()
    for row in rows:
        needed.add(row["image_A"])
        needed.add(row["image_B"])

    out_images_dir.mkdir(parents=True, exist_ok=True)
    needed_dest_names = {jpg_name(n) for n in needed}
    for existing in out_images_dir.iterdir():
        if existing.is_file() and existing.name not in needed_dest_names:
            existing.unlink()

    copied = 0
    for name in needed:
        dest = out_images_dir / jpg_name(name)
        if not dest.exists():
            downscale_image(source_images_dir / name, dest)
            copied += 1
    return len(needed), copied


def downscale_image(src_path, dest_path, max_dimension=1000, quality=82):
    """Web-sized, JPEG-compressed copy: originals are lossless PNGs at
    ~2000-3600px / 2-10MB, but the page only ever displays them at a few
    hundred px, and the repo needs to be small enough for GitHub Pages and
    fast to load for participants. JPEG compresses photographic facade
    images far better than PNG with no visible quality loss at this size."""
    from PIL import Image
    with Image.open(src_path) as im:
        im = im.convert("RGB")
        im.thumbnail((max_dimension, max_dimension), Image.LANCZOS)
        im.save(dest_path, "JPEG", quality=quality, optimize=True)


def write_summary_csv(out_path, selected, n100, n80, n50_added, n50_available,
                       missing_count, dup_count, image_count):
    by_cond = Counter(r["condition"] for r in selected)
    vs = [float(r["visual_similarity_score"]) for r in selected]
    gs = [float(r["graph_similarity_score"]) for r in selected]
    occurrences = list(image_count.values())

    with open(out_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["metric", "value"])
        writer.writerow(["total_trials", len(selected)])
        writer.writerow(["n_screening_score_100", n100])
        writer.writerow(["n_screening_score_80", n80])
        writer.writerow(["n_screening_score_50_added", n50_added])
        writer.writerow(["n_screening_score_50_available", n50_available])
        for cond in sorted(by_cond):
            writer.writerow([f"condition_{cond}_count", by_cond[cond]])
        writer.writerow(["visual_similarity_score_min", round(min(vs), 4)])
        writer.writerow(["visual_similarity_score_max", round(max(vs), 4)])
        writer.writerow(["visual_similarity_score_mean", round(sum(vs) / len(vs), 4)])
        writer.writerow(["graph_similarity_score_min", round(min(gs), 4)])
        writer.writerow(["graph_similarity_score_max", round(max(gs), 4)])
        writer.writerow(["graph_similarity_score_mean", round(sum(gs) / len(gs), 4)])
        writer.writerow(["missing_image_pairs_excluded", missing_count])
        writer.writerow(["duplicate_pairs_removed", dup_count])
        writer.writerow(["unique_images_used", len(image_count)])
        writer.writerow(["max_image_occurrence", max(occurrences) if occurrences else 0])
        writer.writerow(["mean_image_occurrence",
                          round(sum(occurrences) / len(occurrences), 3) if occurrences else 0])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--screening-results", default=str(DEFAULT_SCREENING_RESULTS))
    parser.add_argument("--candidate-pairs", default=str(DEFAULT_CANDIDATE_PAIRS))
    parser.add_argument("--source-images", default=str(DEFAULT_SOURCE_IMAGES))
    parser.add_argument("--n-bins", type=int, default=6)
    parser.add_argument("--target-min-per-bin", type=int, default=60)
    parser.add_argument("--max-image-occurrence", type=int, default=6)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    rows = load_merged_rows(Path(args.screening_results), Path(args.candidate_pairs))
    rows, missing = filter_existing_images(rows, Path(args.source_images))
    rows, dup_count = dedupe(rows)

    pool100 = [r for r in rows if screening_score_of(r) == 100]
    pool80 = [r for r in rows if screening_score_of(r) == 80]
    pool50 = [r for r in rows if screening_score_of(r) == 50]

    baseline = pool100 + pool80

    all_visual = [float(r["visual_similarity_score"]) for r in (baseline + pool50)]
    all_graph = [float(r["graph_similarity_score"]) for r in (baseline + pool50)]
    visual_edges = quantile_bin_edges(all_visual, args.n_bins)
    graph_edges = quantile_bin_edges(all_graph, args.n_bins)

    baseline_bin_counts = {"visual": Counter(), "graph": Counter()}
    image_count = Counter()
    for r in baseline:
        vb = bin_of(float(r["visual_similarity_score"]), visual_edges)
        gb = bin_of(float(r["graph_similarity_score"]), graph_edges)
        baseline_bin_counts["visual"][vb] += 1
        baseline_bin_counts["graph"][gb] += 1
        image_count[r["image_A"]] += 1
        image_count[r["image_B"]] += 1

    added50 = select_pool50_for_coverage(
        pool50, baseline_bin_counts, image_count, visual_edges, graph_edges,
        args.max_image_occurrence, args.target_min_per_bin, args.seed,
    )

    selected = baseline + added50
    rng = random.Random(args.seed)
    rng.shuffle(selected)

    write_trials_csv(selected, OUT_TRIALS)
    n_needed, n_copied = sync_images_folder(selected, Path(args.source_images), OUT_IMAGES_DIR)
    write_summary_csv(
        OUT_SUMMARY, selected, len(pool100), len(pool80), len(added50), len(pool50),
        len(missing), dup_count, image_count,
    )

    print(f"Selected {len(selected)} trials total")
    print(f"  screening_score 100: {len(pool100)} (all kept)")
    print(f"  screening_score 80:  {len(pool80)} (all kept)")
    print(f"  screening_score 50:  {len(added50)} added / {len(pool50)} available")
    print(f"Missing-image pairs excluded: {len(missing)}")
    print(f"Duplicate/A-B-swapped pairs removed: {dup_count}")
    print(f"Images folder: {n_needed} unique images needed, {n_copied} newly copied")
    vs = [float(r["visual_similarity_score"]) for r in selected]
    gs = [float(r["graph_similarity_score"]) for r in selected]
    print(f"visual_similarity_score range: {min(vs):.4f} - {max(vs):.4f}")
    print(f"graph_similarity_score range: {min(gs):.4f} - {max(gs):.4f}")


if __name__ == "__main__":
    main()
