mod carousel;
mod icons;
use js_sys::Function;
use ruyo_layout::{BoxPaint, DisplayList, Photo, Run, TextBlock, measure};
use serde::Deserialize;
use wasm_bindgen::prelude::*;

#[derive(Deserialize)]
struct Post {
    name: Vec<TextRun>,
    handle: String,
    date: String,
    verified: Option<Verified>,
    #[serde(rename = "squareAvatar")]
    square_avatar: bool,
    affiliate: Option<String>,
    counts: Counts,
    avatar: Option<String>,
    body: Vec<TextRun>,
    photos: Vec<Photo>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TextRun {
    text: String,
    #[serde(default)]
    link: bool,
    #[serde(default)]
    color_emoji: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
enum Verified {
    Blue,
    Business,
    Government,
}

#[derive(Deserialize)]
struct Counts {
    replies: u64,
    reposts: u64,
    likes: u64,
    views: u64,
}

fn icon(paths: &str, size: f32, color: &str) -> String {
    format!(
        r#"<svg width="{size}" height="{size}" viewBox="0 0 24 24" fill="{color}" color="{color}">{paths}</svg>"#
    )
}

fn count_label(n: u64) -> String {
    if n == 0 {
        return String::new();
    }
    let (unit, suffix) = if n >= 1_000_000_000 {
        (1_000_000_000, "B")
    } else if n >= 1_000_000 {
        (1_000_000, "M")
    } else if n >= 1_000 {
        (1_000, "K")
    } else {
        return n.to_string();
    };
    let whole = n / unit;
    let tenth = (n % unit) / (unit / 10);
    if whole < 10 && tenth > 0 {
        format!("{whole}.{tenth}{suffix}")
    } else {
        format!("{whole}{suffix}")
    }
}

const FONTS: &str = "TwitterChirp,Arial,'Noto Sans','Noto Sans Arabic','Noto Sans Hebrew','Noto Sans Symbols','Noto Sans Symbols 2','STIX Two Math','Noto Sans Math','Hiragino Sans','Noto Sans SC','Noto Sans KR','Apple Color Emoji'";

fn runs(input: &[TextRun]) -> Vec<Run> {
    const EMOJI: &str = concat!(
        "display:inline-block;width:19px;vertical-align:top;position:relative;top:0.125em;",
        "font-family:'Apple Color Emoji';font-weight:400"
    );
    input
        .iter()
        .map(|run| {
            let style = if run.color_emoji {
                EMOJI
            } else if run.link {
                "color:#1d9bf0"
            } else {
                ""
            };
            Run {
                text: run.text.clone(),
                style: style.into(),
                image: None,
            }
        })
        .collect()
}
fn text(prepare: &Function, runs: Vec<Run>, width: f32, style: &str) -> Result<TextBlock, JsValue> {
    measure(
        prepare,
        runs,
        format!(
            "font-family:{FONTS};font-size:15px;line-height:20px;color:black;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;{style}"
        ),
        width,
        None,
    )
}
fn glyph(list: &mut DisplayList, x: f32, y: f32, paths: &str, size: f32, color: &str) {
    list.svg(x, y, size, icon(paths, size, color));
}

fn header(
    list: &mut DisplayList,
    prepare: &Function,
    post: &Post,
    width: f32,
) -> Result<(), JsValue> {
    let left = 64.;
    let y = 12.;
    if let Some(src) = &post.avatar {
        list.image(
            src,
            16.,
            y,
            40.,
            40.,
            if post.square_avatar {
                BoxPaint::rounded(4.)
            } else {
                BoxPaint::rounded(24.)
            },
        );
    } else {
        list.rect(16., y, 40., 40., BoxPaint::solid([239, 241, 243, 255], 20.));
    }
    let date = if post.date.is_empty() {
        None
    } else {
        let dot = text(prepare, vec![Run::plain("·")], width, "color:#666")?;
        let label = text(prepare, vec![Run::plain(&post.date)], width, "color:#666")?;
        Some((dot, label))
    };
    let badge = post.verified.as_ref().map(|v| match v {
        Verified::Blue => icons::VERIFIED_PREMIUM_COLOR,
        Verified::Business => icons::VERIFIED_BUSINESS_COLOR,
        Verified::Government => icons::VERIFIED_GOVERNMENT_COLOR,
    });
    let decorations = (u8::from(badge.is_some()) + u8::from(post.affiliate.is_some())) as f32 * 19.;
    let room =
        (width - 16. - left - 35. - date.map_or(0., |(dot, label)| dot.width + label.width + 8.))
            .max(0.);
    let name = text(
        prepare,
        runs(&post.name),
        (room - decorations).max(0.),
        "font-weight:700",
    )?;
    list.text(left, y, name);
    let mut x = left + name.width;
    if let Some(paths) = badge {
        glyph(list, x + 4., y + 2.5, paths, 15., "#000");
        x += 19.;
    }
    if let Some(src) = &post.affiliate {
        list.image(
            src,
            x + 4.,
            y + 2.5,
            15.,
            15.,
            BoxPaint {
                squircle: true,
                ..BoxPaint::rounded(7.2)
            },
        );
        x += 19.;
    }
    let handle = text(
        prepare,
        vec![Run::plain(format!("@{}", post.handle))],
        (left + room - x - 4.).max(0.),
        "color:#666;font-feature-settings:'ss01'",
    )?;
    list.text(x + 4., y, handle);
    if let Some((dot, label)) = date {
        let dot_x = x + handle.width + 8.;
        list.text(dot_x, y, dot);
        list.text(dot_x + dot.width + 4., y, label);
    }
    glyph(list, width - 35., 12., icons::MORE_DOTS_HOR, 16., "#000");
    Ok(())
}
fn gallery(list: &mut DisplayList, photos: &[Photo], y: f32, width: f32) -> f32 {
    if photos.is_empty() {
        return y;
    }
    let y = y + 12.;
    if let [p] = photos {
        let aspect = p.width / p.height;
        let w = if aspect < 1. {
            width.min(510. * aspect)
        } else {
            width
        };
        let h = w / aspect;
        list.image(
            &p.url,
            64.,
            y,
            w,
            h,
            BoxPaint {
                squircle: true,
                border: Some((1., [0, 0, 0, 38])),
                ..BoxPaint::rounded(28.8)
            },
        );
        return y + h;
    }
    let aspects = photos
        .iter()
        .map(|p| Some(f64::from(p.width) / f64::from(p.height)))
        .collect::<Vec<_>>();
    let layout = carousel::layout_carousel(&aspects, false);
    let h = layout.height(width);
    let clip = [
        64.,
        y,
        if layout.overflows { width + 16. } else { width },
        h,
    ];
    let mut x = 64.;
    for (p, w) in photos.iter().zip(layout.cell_widths(width)) {
        list.image(
            &p.url,
            x,
            y,
            w,
            h,
            BoxPaint {
                squircle: true,
                inset: 1.,
                border: Some((1., [0, 0, 0, 38])),
                ..BoxPaint::rounded(14.4)
            },
        )
        .clip = Some(clip);
        x += w + 4.;
    }
    y + h
}
fn actions(
    list: &mut DisplayList,
    prepare: &Function,
    counts: &Counts,
    y: f32,
    row_width: f32,
) -> Result<(), JsValue> {
    let bookmark = row_width >= 290.;
    let button = 38.75;
    let slot = (row_width - if bookmark { 2. * button } else { button }) / 4.;
    let mut x = 56.;
    for (paths, n) in [
        (icons::REPLY, counts.replies),
        (icons::REPOST, counts.reposts),
        (icons::HEART, counts.likes),
        (icons::BAR_CHART, counts.views),
    ] {
        let clip = [x, y, slot, 20.];
        list.push(
            x + 10.,
            y + 0.625,
            18.75,
            18.75,
            ruyo_layout::Primitive::Svg {
                svg: icon(paths, 18.75, "#666"),
            },
        )
        .clip = Some(clip);
        if n > 0 {
            let block = text(
                prepare,
                vec![Run::plain(count_label(n))],
                slot,
                "color:#666;font-size:13px;line-height:16px;font-variant-numeric:tabular-nums",
            )?;
            list.push(
                x + 32.75,
                y + 2.,
                block.width,
                block.height,
                ruyo_layout::Primitive::Text { id: block.id },
            )
            .clip = Some(clip);
        }
        x += slot;
    }
    if bookmark {
        glyph(list, x + 10., y + 0.625, icons::BOOKMARK, 18.75, "#666");
        x += button;
    }
    glyph(list, x + 10., y + 0.625, icons::SHARE_IOS, 18.75, "#666");
    Ok(())
}
#[wasm_bindgen]
pub fn layout(content: JsValue, width: u32, prepare: &Function) -> Result<JsValue, JsValue> {
    let post: Post = serde_wasm_bindgen::from_value(content)?;
    let width = width as f32;
    let mut list = DisplayList::default();
    header(&mut list, prepare, &post, width)?;
    let mut y = 32.;
    if !post.body.is_empty() {
        y += 2.;
        let body = text(
            prepare,
            runs(&post.body),
            width - 80.,
            "white-space:pre-wrap;overflow-wrap:anywhere;text-overflow:clip",
        )?;
        list.text(64., y, body);
        y += body.height;
    }
    y = gallery(&mut list, &post.photos, y, width - 80.) + 12.;
    actions(&mut list, prepare, &post.counts, y, width - 64.)?;
    list.finish(y + 20. + 12.)
}
