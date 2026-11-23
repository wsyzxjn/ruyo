//! Rounded and squircle paths adapted from xeet 095ba15, paint/shapes.rs (Apache-2.0).
use tiny_skia::{Path, PathBuilder, Rect as SkRect};
#[derive(Clone, Copy)]
struct Rect {
    x: f32,
    y: f32,
    w: f32,
    h: f32,
}
#[derive(Clone, Copy)]
struct Radii {
    tl: f32,
    tr: f32,
    br: f32,
    bl: f32,
}
/// Cubic Bézier control-point distance for a quarter circle.
const KAPPA: f32 = 0.552_284_8;

/// Exponent of the `squircle` corner curve. Fitted against Chrome; see the
/// module docs.
const SUPER_K: f32 = 4.0;

/// Scales corner radii the way CSS does when they overflow the box:
/// one common factor for all of them, so the shape stays proportional.
fn scale_radii(w: f32, h: f32, r: Radii) -> Radii {
    let r = Radii {
        tl: r.tl.max(0.0),
        tr: r.tr.max(0.0),
        br: r.br.max(0.0),
        bl: r.bl.max(0.0),
    };
    let mut f = 1.0_f32;
    let check = |sum: f32, len: f32, f: &mut f32| {
        if sum > len && sum > 0.0 {
            *f = f.min(len / sum);
        }
    };
    check(r.tl + r.tr, w, &mut f);
    check(r.bl + r.br, w, &mut f);
    check(r.tl + r.bl, h, &mut f);
    check(r.tr + r.br, h, &mut f);
    Radii {
        tl: r.tl * f,
        tr: r.tr * f,
        br: r.br * f,
        bl: r.bl * f,
    }
}

pub fn outline(rect: SkRect, radii: [f32; 4], squircle: bool) -> Option<Path> {
    let rect = Rect {
        x: rect.x(),
        y: rect.y(),
        w: rect.width(),
        h: rect.height(),
    };
    let [tl, tr, br, bl] = radii;
    let radii = scale_radii(rect.w, rect.h, Radii { tl, tr, br, bl });
    if squircle {
        superellipse_rect(rect, radii, SUPER_K)
    } else {
        round_rect(rect, radii)
    }
}
fn rect_path(r: Rect) -> Option<Path> {
    SkRect::from_xywh(r.x, r.y, r.w, r.h).map(PathBuilder::from_rect)
}

/// A rectangle with per-corner circular radii, clockwise from top left.
fn round_rect(r: Rect, radii: Radii) -> Option<Path> {
    if radii.tl == 0.0 && radii.tr == 0.0 && radii.br == 0.0 && radii.bl == 0.0 {
        return rect_path(r);
    }
    let (l, t, rr, b) = (r.x, r.y, r.x + r.w, r.y + r.h);
    let mut p = PathBuilder::new();
    p.move_to(l + radii.tl, t);
    p.line_to(rr - radii.tr, t);
    if radii.tr > 0.0 {
        let k = radii.tr * KAPPA;
        p.cubic_to(rr - radii.tr + k, t, rr, t + radii.tr - k, rr, t + radii.tr);
    }
    p.line_to(rr, b - radii.br);
    if radii.br > 0.0 {
        let k = radii.br * KAPPA;
        p.cubic_to(rr, b - radii.br + k, rr - radii.br + k, b, rr - radii.br, b);
    }
    p.line_to(l + radii.bl, b);
    if radii.bl > 0.0 {
        let k = radii.bl * KAPPA;
        p.cubic_to(l + radii.bl - k, b, l, b - radii.bl + k, l, b - radii.bl);
    }
    p.line_to(l, t + radii.tl);
    if radii.tl > 0.0 {
        let k = radii.tl * KAPPA;
        p.cubic_to(l, t + radii.tl - k, l + radii.tl - k, t, l + radii.tl, t);
    }
    p.close();
    p.finish()
}

/// A rectangle with superellipse corners of exponent `k`.
///
/// Blink does not draw the superellipse itself: it approximates each convex
/// half-corner with one cubic Bézier whose control points come from a symbolic
/// regression fitted to the superellipse (Chrome's "corner cases of
/// implementing corner-shape" write-up). To agree with Chrome pixel for pixel
/// we use the same construction rather than sampling the exact curve, which
/// differs by a few tenths of a pixel at the corner's shoulder.
///
/// The curve lives in a corner box of `rx × ry` with the box's corner at
/// `(cx, cy)`; the first cubic runs from the tangent point on one edge to the
/// 45° point, and the second is its mirror image across the diagonal.
fn superellipse_rect(r: Rect, radii: Radii, k: f32) -> Option<Path> {
    let flat = radii.tl == 0.0 && radii.tr == 0.0 && radii.br == 0.0 && radii.bl == 0.0;
    if flat || !k.is_finite() || k <= 0.0 {
        return rect_path(r);
    }
    let (a, b) = blink_controls(k);
    let h = 0.5f32.powf(1.0 / k);
    let (l, t, rr, bo) = (r.x, r.y, r.x + r.w, r.y + r.h);
    let mut p = PathBuilder::new();

    // One corner, traversed clockwise: `(ux, uy)` points inward along the edge
    // the path arrives on, `(vx, vy)` inward along the edge it leaves on. The
    // profile below runs from the tangent point `(r, 0)` to `(0, r)` through
    // the 45° point `(r(1-h), r(1-h))`.
    let corner =
        |p: &mut PathBuilder, cx: f32, cy: f32, r: f32, ux: f32, uy: f32, vx: f32, vy: f32| {
            if !r.is_finite() || r <= 0.0 {
                return;
            }
            let at = |s: f32, d: f32| (cx + ux * r * s + vx * r * d, cy + uy * r * s + vy * r * d);
            let (x0, y0) = at(1.0, 0.0);
            p.line_to(x0, y0);
            let c = [
                at(1.0 - a, 0.0),
                at(1.0 - h + b, 1.0 - h - b),
                at(1.0 - h, 1.0 - h),
                at(1.0 - h - b, 1.0 - h + b),
                at(0.0, 1.0 - a),
                at(0.0, 1.0),
            ];
            p.cubic_to(c[0].0, c[0].1, c[1].0, c[1].1, c[2].0, c[2].1);
            p.cubic_to(c[3].0, c[3].1, c[4].0, c[4].1, c[5].0, c[5].1);
        };

    p.move_to(l + radii.tl, t);
    p.line_to(rr - radii.tr, t);
    corner(&mut p, rr, t, radii.tr, -1.0, 0.0, 0.0, 1.0);
    p.line_to(rr, bo - radii.br);
    corner(&mut p, rr, bo, radii.br, 0.0, -1.0, -1.0, 0.0);
    p.line_to(l + radii.bl, bo);
    corner(&mut p, l, bo, radii.bl, 1.0, 0.0, 0.0, -1.0);
    p.line_to(l, t + radii.tl);
    corner(&mut p, l, t, radii.tl, 0.0, 1.0, 1.0, 0.0);
    p.close();
    p.finish()
}

/// The two Bézier control parameters Blink derives from the exponent `k`.
///
/// `a` places the first control point inward along the edge; `b` places the
/// second one off the diagonal. The constants are the published fit.
fn blink_controls(k: f32) -> (f32, f32) {
    const P0: f64 = 1.243_092_094_272_424_8;
    const P1: f64 = 2.010_479_023_614_843;
    const P2: f64 = 0.329_229_011_794_437_53;
    const P3: f64 = 0.282_302_314_221_207_3;
    const P4: f64 = 1.347_370_426_105_542_1;
    const P5: f64 = 2.914_946_863_794_981_4;
    const P6: f64 = 0.910_650_710_291_708_6;
    let s = (k as f64).log2();
    let slope = P0 + (P6 - P0) * 0.5 * (1.0 + ((P5 * (s - P1)).tanh()));
    let base = 1.0 / (1.0 + (slope * P1).exp());
    let logistic = 1.0 / (1.0 + (slope * (P1 - s)).exp());
    let a = (logistic - base) / (1.0 - base);
    let b = P2 * (-P3 * s.powf(P4)).exp();
    (a as f32, b as f32)
}
