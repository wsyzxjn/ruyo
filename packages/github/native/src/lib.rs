use js_sys::Function;
use ruyo_layout::{BoxPaint, DisplayList, Run, TextBlock, measure};
use serde::Deserialize;
use wasm_bindgen::prelude::*;

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
enum Kind {
    Repository,
    Issue,
    Pull,
    Release,
    Commit,
    Discussion,
    Profile,
}

#[derive(Deserialize)]
struct Preview {
    kind: Kind,
    author: Option<Actor>,
    byline: Option<String>,
    context: String,
    label: String,
    title: String,
    badge: String,
    body: Option<String>,
    date: Option<String>,
    #[serde(default)]
    facts: Vec<Fact>,
    #[serde(default)]
    chips: Vec<Chip>,
    #[serde(default)]
    reactions: Vec<Chip>,
    #[serde(default)]
    blocks: Vec<Block>,
    image: Option<String>,
    #[serde(default)]
    details: Vec<Section>,
    #[serde(default)]
    languages: Vec<Language>,
    diff: Option<Diff>,
    metrics: Vec<Metric>,
}

#[derive(Deserialize)]
struct Fact {
    icon: Icon,
    text: String,
    #[serde(default)]
    link: bool,
}
#[derive(Deserialize)]
struct Chip {
    text: String,
    color: Option<String>,
}
#[derive(Deserialize)]
struct Block {
    kind: String,
    runs: Vec<Run>,
    marker: Option<String>,
    checked: Option<bool>,
}
#[derive(Deserialize)]
struct Section {
    title: String,
    rows: Vec<Row>,
}
#[derive(Deserialize)]
struct Row {
    name: String,
    value: Option<String>,
    tag: Option<String>,
}
#[derive(Deserialize)]
struct Language {
    name: String,
    percent: f32,
    color: String,
}
#[derive(Deserialize)]
struct Diff {
    additions: u64,
    deletions: u64,
    base: Option<String>,
    head: Option<String>,
}

#[derive(Deserialize)]
struct Actor {
    login: String,
    avatar_url: Option<String>,
}

#[derive(Deserialize)]
struct Metric {
    icon: Icon,
    text: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
enum Icon {
    Star,
    Fork,
    Language,
    License,
    Comments,
    Files,
    People,
    Repo,
    Assets,
    Upvotes,
    Watch,
    Issues,
    Commits,
    Downloads,
    Link,
    Branch,
    Organization,
    Location,
    Milestone,
    Person,
}

impl Icon {
    fn svg(&self) -> &'static str {
        match self {
            Self::Star => include_str!("icons/star.svg"),
            Self::Fork => include_str!("icons/repo-forked.svg"),
            Self::Language => include_str!("icons/code.svg"),
            Self::License => include_str!("icons/law.svg"),
            Self::Comments => include_str!("icons/comment.svg"),
            Self::People => include_str!("icons/people.svg"),
            Self::Repo => include_str!("icons/repo.svg"),
            Self::Assets => include_str!("icons/package.svg"),
            Self::Upvotes => include_str!("icons/arrow-up.svg"),
            Self::Watch => include_str!("icons/eye.svg"),
            Self::Issues => include_str!("icons/issue-opened.svg"),
            Self::Commits => include_str!("icons/git-commit.svg"),
            Self::Downloads => include_str!("icons/download.svg"),
            Self::Files => include_str!("icons/file-diff.svg"),
            Self::Link => include_str!("icons/link.svg"),
            Self::Branch => include_str!("icons/git-branch.svg"),
            Self::Organization => include_str!("icons/organization.svg"),
            Self::Location => include_str!("icons/location.svg"),
            Self::Milestone => include_str!("icons/milestone.svg"),
            Self::Person => include_str!("icons/person.svg"),
        }
    }
}

const BASE: &str = "font-family:system-ui,sans-serif;font-size:14px;line-height:20px;color:#1f2328;overflow-wrap:anywhere;";
fn rich(prepare: &Function, runs: Vec<Run>, width: f32, style: &str) -> Result<TextBlock, JsValue> {
    measure(prepare, runs, format!("{BASE}{style}"), width, None)
}
fn text(prepare: &Function, value: &str, width: f32, style: &str) -> Result<TextBlock, JsValue> {
    rich(prepare, vec![Run::plain(value)], width, style)
}
fn styled(value: impl Into<String>, style: &str) -> Run {
    Run {
        text: value.into(),
        style: style.into(),
        ..Run::default()
    }
}
/// Octicons ship in the muted foreground; state pills and checked boxes need them on a filled background.
fn white(svg: &str) -> String {
    svg.replace("#59636e", "white")
}

const LINE: [u8; 4] = [208, 215, 222, 255];
const SUBTLE: [u8; 4] = [246, 248, 250, 255];
const GREEN: [u8; 4] = [31, 136, 61, 255];
const PURPLE: [u8; 4] = [130, 80, 223, 255];
const RED: [u8; 4] = [207, 34, 46, 255];
const GRAY: [u8; 4] = [89, 99, 110, 255];
const BLUE: [u8; 4] = [9, 105, 218, 255];
const SMALL: &str = "font-size:12px;line-height:17px;color:#59636e";
fn panel(fill: [u8; 4]) -> BoxPaint {
    BoxPaint {
        border: Some((1., LINE)),
        ..BoxPaint::solid(fill, 6.)
    }
}
fn color(hex: &str) -> [u8; 4] {
    let hex = hex.trim_start_matches('#');
    match u32::from_str_radix(hex, 16) {
        Ok(v) if hex.len() == 6 => [(v >> 16) as u8, (v >> 8) as u8, v as u8, 255],
        _ => [139, 148, 158, 255],
    }
}

/// Inline items placed left to right, wrapping to a new row when the next one does not fit.
struct Flow {
    x: f32,
    height: f32,
    gap: f32,
    row_gap: f32,
}
impl Flow {
    fn new(gap: f32, row_gap: f32) -> Self {
        Self {
            x: 0.,
            height: 0.,
            gap,
            row_gap,
        }
    }
}

struct Layout<'a> {
    list: DisplayList,
    prepare: &'a Function,
    pad: f32,
    inner: f32,
    y: f32,
}
impl Layout<'_> {
    fn line(&mut self, value: &str, style: &str) -> Result<(), JsValue> {
        let t = text(self.prepare, value, self.inner, style)?;
        self.list.text(self.pad, self.y, t);
        self.y += t.height;
        Ok(())
    }
    fn place(&mut self, flow: &mut Flow, width: f32, height: f32) -> (f32, f32) {
        if flow.x > 0. && flow.x + width > self.inner {
            self.y += flow.height + flow.row_gap;
            flow.x = 0.;
            flow.height = 0.;
        }
        let at = (self.pad + flow.x, self.y);
        flow.x += width + flow.gap;
        flow.height = flow.height.max(height);
        at
    }
    /// GitHub's state pill: filled with an icon for issue, pull request and discussion states, outlined otherwise.
    fn badge(&mut self, kind: &Kind, value: &str) -> Result<(f32, f32), JsValue> {
        let state = match (kind, value) {
            (Kind::Issue, "Open") => Some((GREEN, include_str!("icons/issue-opened.svg"))),
            (Kind::Issue, "Closed") => Some((PURPLE, include_str!("icons/issue-closed.svg"))),
            (Kind::Issue, "Not planned") => Some((GRAY, include_str!("icons/skip.svg"))),
            (Kind::Pull, "Open") => Some((GREEN, include_str!("icons/git-pull-request.svg"))),
            (Kind::Pull, "Merged") => Some((PURPLE, include_str!("icons/git-merge.svg"))),
            (Kind::Pull, "Closed") => Some((RED, include_str!("icons/git-pull-request-closed.svg"))),
            (Kind::Pull, "Draft") => Some((GRAY, include_str!("icons/git-pull-request-draft.svg"))),
            (Kind::Discussion, "Answered") => Some((GREEN, include_str!("icons/check-circle.svg"))),
            (Kind::Discussion, "Closed") => Some((PURPLE, include_str!("icons/discussion-closed.svg"))),
            _ => None,
        };
        let (x, y) = (self.pad, self.y);
        if let Some((fill, icon)) = state {
            let t = text(
                self.prepare,
                value,
                self.inner - 34.,
                "font-size:12px;line-height:18px;font-weight:600;color:white",
            )?;
            let (w, h) = (t.width + 34., t.height + 6.);
            self.list.rect(x, y, w, h, BoxPaint::solid(fill, h / 2.));
            self.list.svg(x + 9., y + 5., 14., white(icon));
            self.list.text(x + 27., y + 3., t);
            return Ok((w, h));
        }
        let tone = match value {
            "Latest" | "Verified" => "#1a7f37",
            "Pre-release" => "#bc4c00",
            v if v == "Unverified" || v.ends_with(" archive") => "#9a6700",
            _ => "#59636e",
        };
        let t = text(
            self.prepare,
            value,
            self.inner - 18.,
            &format!("font-size:12px;line-height:18px;font-weight:500;color:{tone}"),
        )?;
        let (w, h) = (t.width + 18., t.height + 4.);
        let border = if tone == "#59636e" { LINE } else { color(tone) };
        self.list.rect(
            x,
            y,
            w,
            h,
            BoxPaint {
                border: Some((1., border)),
                ..BoxPaint::rounded(h / 2.)
            },
        );
        self.list.text(x + 9., y + 2., t);
        Ok((w, h))
    }
    fn facts(&mut self, facts: Vec<Fact>) -> Result<(), JsValue> {
        if facts.is_empty() {
            return Ok(());
        }
        let mut flow = Flow::new(16., 4.);
        for fact in facts {
            let style = if fact.link {
                "font-size:13px;font-weight:600;color:#0969da"
            } else {
                "font-size:13px"
            };
            let t = text(self.prepare, &fact.text, self.inner - 22., style)?;
            let (x, y) = self.place(&mut flow, t.width + 22., t.height);
            self.list.svg(x, y + 2., 16., fact.icon.svg().into());
            self.list.text(x + 22., y, t);
        }
        self.y += flow.height + 12.;
        Ok(())
    }
    fn chips(&mut self, chips: &[Chip]) -> Result<(), JsValue> {
        if chips.is_empty() {
            return Ok(());
        }
        let mut flow = Flow::new(5., 5.);
        for chip in chips {
            let c = color(chip.color.as_deref().unwrap_or("8b949e"));
            let fg = format!(
                "font-size:12px;line-height:16px;font-weight:600;color:#{:02x}{:02x}{:02x}",
                c[0] / 2,
                c[1] / 2,
                c[2] / 2
            );
            let t = text(self.prepare, &chip.text, self.inner - 16., &fg)?;
            let (w, h) = (t.width + 16., t.height + 4.);
            let (x, y) = self.place(&mut flow, w, h);
            self.list
                .rect(x, y, w, h, BoxPaint::solid([c[0], c[1], c[2], 40], 10.));
            self.list.text(x + 8., y + 2., t);
        }
        self.y += flow.height + 12.;
        Ok(())
    }
    fn branch(&mut self, flow: &mut Flow, name: &str) -> Result<(), JsValue> {
        let t = text(
            self.prepare,
            name,
            self.inner - 12.,
            "font-family:monospace;font-size:12px;line-height:18px;color:#0969da",
        )?;
        let (w, h) = (t.width + 12., t.height + 4.);
        let (x, y) = self.place(flow, w, h);
        self.list
            .rect(x, y, w, h, BoxPaint::solid([221, 244, 255, 255], 6.));
        self.list.text(x + 6., y + 2., t);
        Ok(())
    }
    fn diff(&mut self, d: Diff) -> Result<(), JsValue> {
        let mut flow = Flow::new(6., 6.);
        if let (Some(base), Some(head)) = (d.base.as_deref(), d.head.as_deref()) {
            self.branch(&mut flow, base)?;
            let arrow = text(self.prepare, "←", 20., "color:#59636e")?;
            let (x, y) = self.place(&mut flow, arrow.width, 22.);
            self.list.text(x, y + 1., arrow);
            self.branch(&mut flow, head)?;
            flow.x += 10.;
        }
        let stats = rich(
            self.prepare,
            vec![
                styled(format!("+{}", d.additions), "color:#1a7f37"),
                Run::plain(" "),
                styled(format!("−{}", d.deletions), "color:#d1242f"),
            ],
            self.inner - 48.,
            "font-size:13px;font-weight:600",
        )?;
        let (x, y) = self.place(&mut flow, stats.width + 48., 22.);
        self.list.text(x, y + 1., stats);
        let total = d.additions + d.deletions;
        let plus = if total <= 5 {
            d.additions
        } else {
            ((5. * d.additions as f64 / total as f64).round() as u64)
                .clamp(u64::from(d.additions > 0), 5 - u64::from(d.deletions > 0))
        };
        for i in 0..5 {
            let c = if i < plus {
                GREEN
            } else if i < total {
                RED
            } else {
                LINE
            };
            self.list.rect(
                x + stats.width + 8. + i as f32 * 8.,
                y + 7.,
                6.,
                8.,
                BoxPaint::solid(c, 1.),
            );
        }
        self.y += flow.height + 12.;
        Ok(())
    }
    fn article(
        &mut self,
        blocks: Vec<Block>,
        image: Option<&str>,
        image_size: &Function,
    ) -> Result<(), JsValue> {
        // The image block stays only when its asset loaded.
        let blocks: Vec<Block> = blocks
            .into_iter()
            .filter(|b| b.kind != "image" || image.is_some())
            .collect();
        if blocks.is_empty() {
            return Ok(());
        }
        let start = self.y;
        let at = self.list.items.len();
        self.list
            .rect(self.pad, start, self.inner, 1., panel([255; 4]));
        self.y += 12.;
        let x = self.pad + 12.;
        let width = self.inner - 24.;
        let mut previous: Option<String> = None;
        for block in blocks {
            if let Some(previous) = previous.as_deref() {
                self.y += match (previous, block.kind.as_str()) {
                    ("list", "list") => 3.,
                    (_, "heading") => 12.,
                    _ => 8.,
                };
            }
            let body = format!(
                "line-height:21px;{}",
                match block.kind.as_str() {
                    "heading" => "font-size:16px;font-weight:600;line-height:24px",
                    "quote" => "color:#59636e",
                    "more" => "font-size:13px;color:#0969da",
                    _ => "",
                }
            );
            match block.kind.as_str() {
                "image" => {
                    let src = image.unwrap_or_default();
                    let [iw, ih]: [f32; 2] = serde_wasm_bindgen::from_value(
                        image_size.call1(&JsValue::UNDEFINED, &src.into())?,
                    )?;
                    let scale = (width / iw).min(200. / ih).min(1.);
                    self.list.image(
                        src,
                        x,
                        self.y,
                        iw * scale,
                        ih * scale,
                        BoxPaint::rounded(6.),
                    );
                    self.y += ih * scale;
                }
                "code" => {
                    let t = rich(
                        self.prepare,
                        block.runs,
                        width - 20.,
                        "font-family:monospace;font-size:12px;line-height:18px;white-space:pre-wrap",
                    )?;
                    self.list.rect(
                        x,
                        self.y,
                        width,
                        t.height + 16.,
                        BoxPaint::solid(SUBTLE, 6.),
                    );
                    self.list.text(x + 10., self.y + 8., t);
                    self.y += t.height + 16.;
                }
                "quote" => {
                    let t = rich(self.prepare, block.runs, width - 14., &body)?;
                    self.list
                        .rect(x, self.y, 3., t.height, BoxPaint::solid(LINE, 1.5));
                    self.list.text(x + 14., self.y, t);
                    self.y += t.height;
                }
                "list" => {
                    // A hanging indent keeps wrapped lines aligned with the item's text, not its marker.
                    let indent = match (&block.checked, &block.marker) {
                        (Some(_), _) => 22.,
                        (None, Some(_)) => 24.,
                        _ => 18.,
                    };
                    let t = rich(self.prepare, block.runs, width - indent, &body)?;
                    if let Some(checked) = block.checked {
                        let paint = if checked {
                            BoxPaint::solid(BLUE, 3.)
                        } else {
                            BoxPaint {
                                border: Some((1., [129, 139, 152, 255])),
                                ..BoxPaint::solid([255; 4], 3.)
                            }
                        };
                        self.list.rect(x + 1., self.y + 3.5, 14., 14., paint);
                        if checked {
                            self.list.svg(
                                x + 2.,
                                self.y + 4.5,
                                12.,
                                white(include_str!("icons/check.svg")),
                            );
                        }
                    } else {
                        let marker = block.marker.as_deref().unwrap_or("•");
                        let m = text(self.prepare, marker, indent, "line-height:21px")?;
                        let mx = if block.marker.is_some() {
                            x + indent - 6. - m.width
                        } else {
                            x + 4.
                        };
                        self.list.text(mx, self.y, m);
                    }
                    self.list.text(x + indent, self.y, t);
                    self.y += t.height;
                }
                _ => {
                    let t = rich(self.prepare, block.runs, width, &body)?;
                    self.list.text(x, self.y, t);
                    self.y += t.height;
                }
            }
            previous = Some(block.kind);
        }
        self.y += 12.;
        self.list.items[at].height = self.y - start;
        self.y += 14.;
        Ok(())
    }
    fn section(&mut self, section: Section) -> Result<(), JsValue> {
        if section.rows.is_empty() {
            return Ok(());
        }
        self.line(&section.title, "font-size:13px;font-weight:600")?;
        self.y += 5.;
        for row in section.rows {
            let y = self.y;
            self.list
                .rect(self.pad, y, self.inner, 1., BoxPaint::solid(LINE, 0.));
            self.y += 6.;
            let marker = row.tag.as_deref().unwrap_or("");
            let left = if marker.is_empty() { 0. } else { 22. };
            if left > 0. {
                let col = match marker {
                    "A" => "#1a7f37",
                    "D" => "#cf222e",
                    _ => "#8250df",
                };
                let t = text(
                    self.prepare,
                    marker,
                    20.,
                    &format!("font-weight:600;color:{col}"),
                )?;
                self.list.text(self.pad, self.y, t);
            }
            let val = row.value.as_deref().unwrap_or("");
            let v = text(self.prepare, val, self.inner * 0.46, SMALL)?;
            let gap = if val.is_empty() { 0. } else { 10. + v.width };
            let n = text(
                self.prepare,
                &row.name,
                self.inner - left - gap,
                "font-size:13px;line-height:18px",
            )?;
            self.list.text(self.pad + left, self.y, n);
            if !val.is_empty() {
                self.list.text(self.pad + self.inner - v.width, self.y, v);
            }
            self.y += n.height.max(v.height) + 6.;
        }
        self.y += 10.;
        Ok(())
    }
    fn languages(&mut self, languages: Vec<Language>) -> Result<(), JsValue> {
        if languages.is_empty() {
            return Ok(());
        }
        self.line("Languages", "font-size:13px;font-weight:600")?;
        self.y += 6.;
        // Like GitHub's bar: segments split by 2px gaps, with only the bar's outer ends rounded.
        let gap = 2.;
        let span = self.inner - gap * (languages.len() - 1) as f32;
        let last = languages.len() - 1;
        let mut x = self.pad;
        for (i, lang) in languages.iter().enumerate() {
            let w = span * lang.percent / 100.;
            let fill = color(&lang.color);
            let end = i == 0 || i == last;
            self.list.rect(
                x,
                self.y,
                w,
                8.,
                BoxPaint::solid(fill, if end { 4. } else { 0. }),
            );
            if end && last > 0 {
                let flat = if i == 0 { x + w / 2. } else { x };
                self.list
                    .rect(flat, self.y, w / 2., 8., BoxPaint::solid(fill, 0.));
            }
            x += w + gap;
        }
        self.y += 18.;
        let mut flow = Flow::new(16., 4.);
        for lang in languages {
            let percent = text(
                self.prepare,
                &format!("{:.1}%", lang.percent),
                self.inner,
                "font-size:12px;line-height:18px;color:#59636e",
            )?;
            let name = text(
                self.prepare,
                &lang.name,
                (self.inner - 18. - percent.width).max(1.),
                "font-size:12px;line-height:18px;font-weight:600",
            )?;
            let (x, y) = self.place(&mut flow, 18. + name.width + percent.width, name.height);
            self.list
                .rect(x, y + 5., 8., 8., BoxPaint::solid(color(&lang.color), 4.));
            self.list.text(x + 14., y, name);
            self.list.text(x + 18. + name.width, y, percent);
        }
        self.y += flow.height + 14.;
        Ok(())
    }
    fn metrics(&mut self, metrics: Vec<Metric>, width: f32) -> Result<(), JsValue> {
        if metrics.is_empty() {
            return Ok(());
        }
        let start = self.y;
        let at = self.list.items.len();
        self.list
            .rect(0., start, width, 1., BoxPaint::solid(SUBTLE, 0.));
        self.list.rect(0., start, width, 1., BoxPaint::solid(LINE, 0.));
        self.y += 10.;
        let mut flow = Flow::new(15., 5.);
        for metric in metrics {
            let t = text(self.prepare, &metric.text, self.inner - 21., SMALL)?;
            let (x, y) = self.place(&mut flow, t.width + 21., t.height);
            self.list.svg(x, y + 1., 15., metric.icon.svg().into());
            self.list.text(x + 21., y, t);
        }
        self.y += flow.height + 10.;
        self.list.items[at].height = self.y - start;
        Ok(())
    }
}

#[wasm_bindgen]
pub fn layout(
    content: JsValue,
    width: u32,
    prepare: &Function,
    image_size: &Function,
) -> Result<JsValue, JsValue> {
    let card: Preview = serde_wasm_bindgen::from_value(content)?;
    let width = width as f32;
    let pad = if width >= 400. { 24. } else { 14. };
    let inner = width - 2. * pad;
    let mut l = Layout {
        list: DisplayList::default(),
        prepare,
        pad,
        inner,
        y: 0.,
    };

    // Where the item lives on the left, what it is on the right; one line when the card is narrow.
    let heading = "font-size:13px;font-weight:600;line-height:18px";
    let wide = inner >= 280.;
    let label = if wide {
        Some(text(prepare, &card.label, inner / 2., SMALL)?)
    } else {
        None
    };
    let top = match label {
        Some(label) => text(prepare, &card.context, inner - label.width - 45., heading)?,
        None => rich(
            prepare,
            vec![
                Run::plain(card.context.as_str()),
                styled(format!(" · {}", card.label), "font-weight:400;color:#59636e"),
            ],
            inner - 25.,
            heading,
        )?,
    };
    let hh = top.height.max(20.) + 18.;
    l.list.rect(0., 0., width, hh, BoxPaint::solid(SUBTLE, 0.));
    l.list.rect(0., hh, width, 1., BoxPaint::solid(LINE, 0.));
    l.list
        .svg(pad, 9., 18., include_str!("icons/mark-github.svg").into());
    l.list.text(pad + 25., 9., top);
    if let Some(label) = label {
        l.list.text(width - pad - label.width, 10., label);
    }

    l.y = hh + 16.;
    let large = matches!(card.kind, Kind::Profile | Kind::Repository);
    let avatar = card.author.as_ref().and_then(|a| a.avatar_url.as_deref());
    let offset = if large && avatar.is_some() { 48. } else { 0. };
    let title = text(
        prepare,
        &card.title,
        inner - offset,
        "font-size:22px;font-weight:600;line-height:28px",
    )?;
    if large && let Some(src) = avatar {
        l.list
            .image(src, pad, l.y, 38., 38., BoxPaint::rounded(19.));
    }
    l.list.text(pad + offset, l.y, title);
    l.y += title.height.max(if offset > 0. { 38. } else { 0. }) + 8.;

    let row = l.y;
    let (pill_w, pill_h) = if card.badge.is_empty() {
        (0., 0.)
    } else {
        l.badge(&card.kind, &card.badge)?
    };
    let meta = [
        card.byline
            .as_deref()
            .or(card.author.as_ref().map(|a| a.login.as_str())),
        card.date.as_deref(),
    ]
    .into_iter()
    .flatten()
    .filter(|s| !s.is_empty())
    .collect::<Vec<_>>()
    .join(" · ");
    let small_avatar = if large { None } else { avatar };
    let mut x = if pill_w > 0. { pill_w + 10. } else { 0. };
    let mut line = row;
    let mut line_h = pill_h.max(20.);
    if x > 0. && inner - x < 120. && (!meta.is_empty() || small_avatar.is_some()) {
        line = row + pill_h + 8.;
        line_h = 20.;
        x = 0.;
    }
    let mut bottom = row + pill_h;
    if let Some(src) = small_avatar {
        l.list.image(
            src,
            pad + x,
            line + (line_h - 20.) / 2.,
            20.,
            20.,
            BoxPaint::rounded(10.),
        );
        x += 26.;
        bottom = bottom.max(line + line_h);
    }
    if !meta.is_empty() {
        let t = text(prepare, &meta, (inner - x).max(1.), SMALL)?;
        let ty = line + (line_h - 17.) / 2.;
        l.list.text(pad + x, ty, t);
        bottom = bottom.max(ty + t.height);
    }
    l.y = if bottom > row { bottom + 14. } else { row + 6. };

    if let Some(b) = card.body.filter(|s| !s.is_empty()) {
        l.line(&b, "color:#414951")?;
        l.y += 12.;
    }
    l.facts(card.facts)?;
    l.chips(&card.chips)?;
    if let Some(diff) = card.diff {
        l.diff(diff)?;
    }
    l.article(card.blocks, card.image.as_deref(), image_size)?;
    l.languages(card.languages)?;
    for s in card.details {
        l.section(s)?;
    }
    l.chips(&card.reactions)?;
    l.metrics(card.metrics, width)?;
    l.list.finish(l.y)
}
