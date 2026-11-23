// Adapted from rauchg/xeet (095ba15), crates/xeet-core/src/cards/media.rs.
// Apache-2.0. Only the carousel geometry is used here.
fn snap(n: f64) -> f32 {
    ((n * 64.0).floor() / 64.0) as f32
}
/// The carousel gap, `--spacing(1)`.
pub(crate) const GAP: f64 = 4.0;
/// `EC`: height ratio of one slide.
const BASE: f64 = 0.68;
/// `DC`: widest a cell may be relative to its own height.
const MAX_CELL: f64 = 0.8;
/// `t` in the client's peek candidates.
const PEEK: f64 = 0.67;
/// `NC`: fallback height ratio when every image has a size.
const FALLBACK: f64 = 1.24446;
/// `MC`: `BASE` multiplier in the compact (quoted) variant.
const COMPACT_BASE: f64 = 0.85;
/// `PC`: fallback height ratio in the compact variant.
const COMPACT_FALLBACK: f64 = 0.66;
/// `jC`: if at least this much of the slot would be empty, keep the base.
const SPARE: f64 = 0.33;
/// `AC`: the same threshold for the two-image branch.
const SPARE_2: f64 = 0.33;
/// Where the carousel landed.
#[derive(Clone, Debug, PartialEq)]
pub struct MediaLayout {
    pub overflows: bool,
    /// Cell height as a fraction of the slot width.
    pub height_ratio: f32,
    /// Extra pixels added to that height (always ≤ 0).
    pub height_offset: f32,
    /// Cell width for each item, as a multiple of the cell height, in double
    /// precision: X writes these as 16-digit CSS numbers (`1.1764705882352942`)
    /// and the extra digits decide which 1/64 px the cell lands on.
    pub item_aspects: Vec<f64>,
}

impl MediaLayout {
    /// Cell height in CSS pixels for a slot `width` wide, on Chrome's 1/64 px
    /// layout grid.
    pub fn height(&self, width: f32) -> f32 {
        snap(self.height_ratio as f64 * width as f64 + self.height_offset as f64)
    }

    /// The width of each cell in CSS pixels.
    pub fn cell_widths(&self, width: f32) -> Vec<f32> {
        let h = self.height(width);
        self.item_aspects
            .iter()
            .map(|a| snap(*a * h as f64))
            .collect()
    }
}

#[derive(Clone, Copy, Debug)]
struct Ratio {
    ratio: f64,
    offset: f64,
}

fn ratio(ratio: f64, offset: f64) -> Ratio {
    Ratio { ratio, offset }
}

/// `uC`: the smaller of two layouts.
fn min_ratio(a: Ratio, b: Ratio) -> Ratio {
    if a.ratio <= b.ratio { a } else { b }
}

/// `dC`: the larger of two layouts.
fn max_ratio(a: Ratio, b: Ratio) -> Ratio {
    if a.ratio >= b.ratio { a } else { b }
}

/// `mC`: one cell's aspect ratio at a given height ratio, capped at `MAX_CELL`.
/// A missing size means the cell fills the height, i.e. a square cell.
fn cell_ratio(height: f64, ar: Option<f64>) -> f64 {
    match ar {
        None => height,
        Some(a) => (height * a).min(MAX_CELL),
    }
}

/// `hC`: the height ratio at which every cell fits the slot width exactly.
fn fit(ars: &[Option<f64>]) -> Option<Ratio> {
    let known: Option<Vec<f64>> = ars.iter().copied().collect();
    let numeric = known?;
    if numeric.len() < 2 || numeric.iter().any(|&a| a <= 0.0) {
        return None;
    }
    let gaps = GAP * (numeric.len() - 1) as f64;
    let mut rest: Vec<f64> = numeric;
    let mut dropped = 0usize;
    loop {
        let sum: f64 = rest.iter().sum();
        if sum <= 0.0 {
            return None;
        }
        let height = (1.0 - dropped as f64 * MAX_CELL) / sum;
        if height <= 0.0 {
            return None;
        }
        let keep: Vec<f64> = rest
            .iter()
            .copied()
            .filter(|&a| height * a <= MAX_CELL)
            .collect();
        if keep.len() == rest.len() {
            return Some(ratio(height, -gaps * height));
        }
        dropped += rest.len() - keep.len();
        if keep.is_empty() {
            return None;
        }
        rest = keep;
    }
}

/// `vC`: the "one slide and a peek of the next" candidates.
fn peek(ars: &[Option<f64>]) -> Option<Ratio> {
    let ar0 = ars.first().copied().flatten().unwrap_or(1.0);
    let ar1 = ars.get(1).copied().flatten().unwrap_or(1.0);
    if ar0 <= 0.0 || ar1 <= 0.0 {
        return None;
    }
    let has0 = ars.first().is_some_and(|a| a.is_some());
    let has1 = ars.get(1).is_some_and(|a| a.is_some());
    let mut candidates: Vec<Ratio> = Vec::with_capacity(3);
    let mut push = |num: f64, den: f64| {
        if den > 0.0 {
            let r = num / den;
            if r > 0.0 {
                candidates.push(ratio(r, -GAP * r));
            }
        }
    };
    // A whole first slide plus `PEEK` of the second.
    let den = ar0 + PEEK * ar1;
    let h = if den > 0.0 { 1.0 / den } else { 0.0 };
    if h > 0.0 && (!has0 || h * ar0 <= MAX_CELL) && (!has1 || h * ar1 <= MAX_CELL) {
        push(1.0, den);
    }
    // Most of the second slide.
    if has0 {
        let d = PEEK * ar1;
        let h = if d > 0.0 { 0.2 / d } else { 0.0 };
        if h > 0.0 && h * ar0 >= MAX_CELL && (!has1 || h * ar1 <= MAX_CELL) {
            push(0.2, d);
        }
    }
    // Most of the first slide.
    if has1 {
        let d = ar0;
        let h = if d > 0.0 {
            (1.0 - PEEK * MAX_CELL) / d
        } else {
            0.0
        };
        if h > 0.0 && h * ar1 >= MAX_CELL && (!has0 || h * ar0 <= MAX_CELL) {
            push(1.0 - PEEK * MAX_CELL, d);
        }
    }
    candidates.into_iter().reduce(min_ratio)
}

/// `gC`: how much of the second slide is visible, 0..=1.
fn second_visible(e: Ratio, ars: &[Option<f64>]) -> f64 {
    let n = cell_ratio(e.ratio, ars.first().copied().flatten());
    let r = cell_ratio(e.ratio, ars.get(1).copied().flatten());
    if r <= 0.0 {
        return 0.0;
    }
    (1.0 - n).max(0.0).min(r) / r
}

/// `_C`: the tallest height ratio at which the first `n` cells stay capped.
fn limited(ars: &[Option<f64>], n: usize) -> Option<Ratio> {
    let mut limit = f64::INFINITY;
    let mut any = false;
    for a in ars.iter().take(n).flatten() {
        if *a > 0.0 {
            limit = limit.min(MAX_CELL / a);
            any = true;
        }
    }
    any.then(|| ratio(limit, 0.0))
}

/// `yC`: prefer the exact fit, but never stretch past the fallback.
fn prefer_fit(e: Ratio, ars: &[Option<f64>], fallback: Ratio) -> Ratio {
    match fit(ars) {
        Some(f) if f.ratio >= e.ratio => min_ratio(f, fallback),
        _ => e,
    }
}

/// `bC`: the two-image case.
fn two(e: Ratio, ars: &[Option<f64>]) -> Ratio {
    match fit(ars) {
        Some(f) if f.ratio < e.ratio && second_visible(e, ars) >= SPARE_2 => f,
        _ => e,
    }
}

/// `xC`: three or more images.
fn many(e: Ratio, ars: &[Option<f64>], fallback: Ratio) -> Ratio {
    if 1.0 - second_visible(e, ars) >= SPARE {
        return e;
    }
    let Some(p) = peek(ars) else { return e };
    let mut best = min_ratio(p, fallback);
    if let Some(cap) = limited(ars, 2) {
        best = min_ratio(best, max_ratio(cap, e));
    }
    if best.ratio > e.ratio { best } else { e }
}

/// `SC`: the count-dependent dispatch.
fn dispatch(e: Ratio, ars: &[Option<f64>], fallback: Ratio) -> Ratio {
    match ars.len() {
        0 | 1 => e,
        2 => two(e, ars),
        _ => many(e, ars, fallback),
    }
}

/// Port of the client's `wC`: the carousel layout for a list of image aspect
/// ratios (in attachment order). `compact` is X's quoted-post variant.
pub fn layout_carousel(ars: &[Option<f64>], compact: bool) -> MediaLayout {
    let ars: Vec<Option<f64>> = ars
        .iter()
        .map(|a| a.filter(|v| v.is_finite() && *v > 0.0))
        .collect();
    let base = if compact { BASE * COMPACT_BASE } else { BASE };
    let fallback = if compact {
        ratio(COMPACT_FALLBACK, 0.0)
    } else {
        ratio(FALLBACK, 0.0)
    };
    // `uC(i, FC)` when some size is missing, `i` otherwise.
    let anchor = if ars.iter().any(|a| a.is_none()) {
        min_ratio(fallback, ratio(MAX_CELL, 0.0))
    } else {
        fallback
    };
    let start = min_ratio(ratio(base, 0.0), anchor);
    let chosen = dispatch(prefer_fit(start, &ars, anchor), &ars, anchor);
    let h = chosen.ratio;
    let item_aspects: Vec<f64> = ars.iter().map(|&a| cell_ratio(h, a) / h).collect();
    MediaLayout {
        overflows: chosen.ratio * item_aspects.iter().sum::<f64>() > 1.000001,
        height_ratio: chosen.ratio as f32,
        height_offset: chosen.offset as f32,
        item_aspects,
    }
}
