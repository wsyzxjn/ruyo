mod video;
use js_sys::Function;
use ruyo_layout::{BoxPaint, DisplayList, Photo, Run, TextBlock, measure};
use serde::Deserialize;
use wasm_bindgen::prelude::*;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Dynamic {
    name: String,
    date: String,
    avatar: Option<String>,
    nickname_color: Option<String>,
    decoration: Option<String>,
    title: Option<String>,
    topic: Option<String>,
    body: Vec<RichRun>,
    photos: Vec<Photo>,
    video: Option<video::VideoPreview>,
    cropped_cover: bool,
    stats: Vec<Stat>,
}

#[derive(Deserialize)]
struct Stat {
    kind: StatKind,
    value: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
enum StatKind {
    Like,
    Coin,
    Favorite,
    Forward,
    Comment,
}

fn stat_footer(
    list: &mut DisplayList,
    prepare: &Function,
    stats: &[Stat],
    inset: f32,
    inner: f32,
    body_end: f32,
) -> Result<f32, JsValue> {
    if stats.is_empty() {
        return Ok(body_end + 36.);
    }
    // Lay the desktop side toolbar out in rows to fit the exported card.
    let columns = ((inner / 52.).floor() as usize).clamp(1, stats.len());
    let mut y = body_end + 24.;
    for row in stats.chunks(columns) {
        let cell = inner / row.len() as f32;
        for (i, stat) in row.iter().enumerate() {
            let center = inset + cell * (i as f32 + 0.5);
            let icon = match stat.kind {
                StatKind::Like => include_str!("../../assets/like.svg"),
                StatKind::Coin => include_str!("../../assets/coin.svg"),
                StatKind::Favorite => include_str!("../../assets/favorite.svg"),
                StatKind::Forward => include_str!("../../assets/forward.svg"),
                StatKind::Comment => include_str!("../../assets/comment.svg"),
            };
            list.svg(center - 12., y, 24., icon.into());
            let count = text(
                prepare,
                vec![Run::plain(&stat.value)],
                cell,
                "color:#9499a0;font-size:12px;line-height:14px;white-space:nowrap",
            )?;
            list.text(center - count.width / 2., y + 28., count);
        }
        y += 54.;
    }
    Ok(y + 12.)
}

#[derive(Deserialize)]
struct RichRun {
    text: String,
    link: Option<bool>,
    emoji: Option<String>,
}
fn text(prepare: &Function, runs: Vec<Run>, width: f32, style: &str) -> Result<TextBlock, JsValue> {
    measure(
        prepare,
        runs,
        format!("font-family:system-ui,sans-serif;font-size:17px;color:#18191c;{style}"),
        width,
        Some("zh-CN"),
    )
}
fn gallery(
    list: &mut DisplayList,
    prepare: &Function,
    post: &Dynamic,
    width: f32,
    inset: f32,
) -> Result<f32, JsValue> {
    let Some(first) = post.photos.first() else {
        return Ok(0.);
    };
    let ratio = first.height / first.width;
    if post.photos.len() == 1 {
        let cap = (width * 399. / 708.).round();
        let h = if first.width > 1416. && first.height > 798. {
            cap
        } else {
            (width * ratio).round().min(cap)
        };
        list.image(
            &first.url,
            0.,
            0.,
            width,
            h,
            BoxPaint {
                contain: post.cropped_cover,
                ..BoxPaint::solid([241, 242, 243, 255], 0.)
            },
        );
        return Ok(h + 20.);
    }
    let inner = width - 2. * inset;
    let h = inner * ratio.clamp(9. / 16., 522. / 596.);
    let long = ratio > 21. / 9.;
    let display_ratio = if long { 4. / 3. } else { ratio };
    let w = if ratio < 9. / 16. {
        inner
    } else {
        inner
            .min(first.width)
            .min(first.height.min(h) / display_ratio)
    };
    let ph = w * display_ratio;
    let x = (width - w) / 2.;
    let y = 20. + (h - ph) / 2.;
    let clip = [inset, 20., inner, h];
    if ratio > 4. / 3. && !long {
        let bw = h * 0.75;
        list.image(
            &first.url,
            (width - bw) / 2.,
            y,
            bw,
            ph,
            BoxPaint {
                blur: 40.,
                ..Default::default()
            },
        )
        .clip = Some(clip);
    }
    list.image(&first.url, x, y, w, ph, BoxPaint::rounded(4.))
        .clip = Some(clip);
    if long {
        let block = text(
            prepare,
            vec![Run::plain("长图")],
            inner,
            "color:white;font-size:12px;line-height:17px",
        )?;
        let tx = x + w - 8. - block.width - 8.;
        let ty = y + ph - 27.;
        list.rect(
            tx,
            ty,
            block.width + 8.,
            19.,
            BoxPaint::solid([0, 0, 0, 136], 2.),
        );
        list.text(tx + 4., ty + 1., block);
    }
    let thumb_y = 20. + h + 12.;
    let strip = (post.photos.len().min(9) as f32 * 44. - 4.).min(inner);
    let start = (width - strip) / 2.;
    for (i, photo) in post.photos.iter().take(9).enumerate() {
        let px = start + 44. * i as f32;
        let paint = if i == 0 {
            BoxPaint {
                inset: 4.,
                border: Some((2., [251, 114, 153, 255])),
                ..BoxPaint::rounded(4.)
            }
        } else {
            BoxPaint::rounded(4.)
        };
        list.image(&photo.url, px, thumb_y, 40., 40., paint).clip =
            Some([start, thumb_y, strip, 40.]);
    }
    if inset >= 44. {
        for (x, flip) in [(12., true), (width - 48., false)] {
            let y = 20. + h / 2. - 18.;
            list.rect(
                x,
                y,
                36.,
                36.,
                BoxPaint {
                    border: Some((1., [227, 229, 231, 255])),
                    ..BoxPaint::solid([255; 4], 18.)
                },
            );
            list.image(
                "ruyo:bilibili/album-arrow",
                x + 6.,
                y + 6.,
                24.,
                24.,
                BoxPaint {
                    rotate_half_turn: flip,
                    ..Default::default()
                },
            );
        }
    }
    Ok(thumb_y + 40. + 16.)
}
#[wasm_bindgen]
pub fn layout(
    content: JsValue,
    width: u32,
    prepare: &Function,
    image_size: &Function,
) -> Result<JsValue, JsValue> {
    let post: Dynamic = serde_wasm_bindgen::from_value(content)?;
    let width = width as f32;
    let inset = if width >= 500. { 56. } else { 16. };
    let inner = width - 2. * inset;
    let mut list = DisplayList {
        radii: [6., 6., 0., 0.],
        ..Default::default()
    };
    let mut y = gallery(&mut list, prepare, &post, width, inset)?;
    let title = post.title.as_deref().filter(|s| !s.is_empty());
    if let Some(title) = title {
        y += if post.photos.is_empty() { 40. } else { 20. };
        let block = text(
            prepare,
            vec![Run::plain(title)],
            inner,
            "font-size:24px;line-height:36px;font-weight:700;overflow-wrap:anywhere",
        )?;
        list.text(inset, y, block);
        y += block.height;
    }
    y += if post.photos.is_empty() && title.is_none() {
        40.
    } else {
        12.
    };
    if let Some(url) = &post.avatar {
        list.image(url, inset, y, 48., 48., BoxPaint::rounded(24.));
    } else {
        list.rect(
            inset,
            y,
            48.,
            48.,
            BoxPaint::solid([239, 241, 243, 255], 24.),
        );
    }
    let more_x = width - inset - 24.;
    let mut end = more_x;
    if let Some(src) = &post.decoration {
        let [iw, ih]: [f32; 2] = serde_wasm_bindgen::from_value(
            image_size.call1(&JsValue::UNDEFINED, &JsValue::from_str(src))?,
        )?;
        let w = (34. * iw / ih)
            .min(110.)
            .min((end - inset - 64. - 8.).max(0.));
        end -= 8. + w;
        list.image(
            src,
            end,
            y + 7.,
            w,
            34.,
            BoxPaint {
                contain: true,
                ..Default::default()
            },
        );
    }
    let tx = inset + 64.;
    let name = text(
        prepare,
        vec![Run::plain(post.name)],
        (end - tx).max(0.),
        &format!(
            "color:{};font-weight:600;line-height:24px;white-space:nowrap;text-overflow:ellipsis;overflow:hidden",
            post.nickname_color.as_deref().unwrap_or("#18191c")
        ),
    )?;
    list.text(tx, y + 2., name);
    let date = text(
        prepare,
        vec![Run::plain(post.date)],
        (end - tx).max(0.),
        "font-size:13px;line-height:18px;color:#9499a0",
    )?;
    list.text(tx, y + 28., date);
    list.svg(more_x,y+12.,24.,r##"<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="#9499a0"><circle cx="12" cy="5.5" r="1.75"/><circle cx="12" cy="12" r="1.75"/><circle cx="12" cy="18.5" r="1.75"/></svg>"##.into());
    y += 60.;
    if let Some(topic) = post.topic.filter(|s| !s.is_empty()) {
        let block = text(
            prepare,
            vec![Run::plain(format!("#{topic}"))],
            inner,
            "color:#008ac5",
        )?;
        list.text(inset, y, block);
        y += block.height + 6.;
    }
    let runs: Vec<Run> = post
        .body
        .into_iter()
        .map(|r| Run {
            style: if r.emoji.is_some() {
                "display:inline-block;width:1.3em;height:1.3em;margin:0 1px;vertical-align:-0.3em"
            } else if r.link == Some(true) {
                "color:#008ac5"
            } else {
                ""
            }
            .into(),
            text: r.text,
            image: r.emoji,
        })
        .collect();
    if post.video.is_none() || runs.iter().any(|r| !r.text.is_empty() || r.image.is_some()) {
        let block = text(
            prepare,
            runs,
            inner,
            "color:#2f3238;line-height:29px;white-space:pre-wrap;overflow-wrap:anywhere",
        )?;
        list.text(inset, y, block);
        y += block.height;
    }
    if let Some(video) = &post.video {
        y = video.draw(&mut list, prepare, inset, y + 8., inner)?;
    }
    let height = stat_footer(&mut list, prepare, &post.stats, inset, inner, y)?;
    list.finish(height)
}
