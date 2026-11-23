// osascript's JavaScript bridge to Core Text. Each request contains ordered groups of new graphemes.
ObjC.import('Foundation')
ObjC.import('CoreText')

function fontPath(font) {
  const url = $.CTFontCopyAttribute(font, $.kCTFontURLAttribute)
  const path = $.CFURLCopyFileSystemPath(url, 0)
  const ascii = $.CFStringGetCStringPtr(path, $.kCFStringEncodingUTF8)
  if (ascii) return ascii
  const length = $.CFStringGetLength(path)
  let value = ''
  for (let i = 0; i < length; i++)
    value += String.fromCharCode($.CFStringGetCharacterAtIndex(path, i))
  return value
}

function run() {
  const input = $.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile
  const request = JSON.parse($.NSString.alloc.initWithDataEncoding(input, $.NSUTF8StringEncoding).js)
  // Cocoa's user fixed-pitch font is the system's generic monospace face.
  if (request.monospace) return JSON.stringify([fontPath($.CTFontCreateUIFontForLanguage($.kCTFontUIFontUserFixedPitch, 17, null))])
  const { groups } = request
  const paths = groups.map(() => new Set())
  for (const role of [$.kCTFontUIFontSystem, $.kCTFontUIFontEmphasizedSystem]) {
    const ui = $.CTFontCreateUIFontForLanguage(role, 17, null)
    const base = fontPath(ui)
    groups.forEach((graphemes, i) => {
      paths[i].add(base)
      for (const text of graphemes) {
        const font = $.CTFontCreateForString(ui, $(text), $.CFRangeMake(0, text.length))
        paths[i].add(fontPath(font))
      }
    })
  }
  return JSON.stringify(paths.map(group => [...group]))
}
