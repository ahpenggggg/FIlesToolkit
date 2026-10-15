FileToolkit brand assets
========================

Colours
  Ink     #0F2236   (folder / text)
  Accent  #F25C24   (the lit tile)
  Light   #EEF1F4   (light background)
Font: Space Grotesk — "File" Regular 400, "Toolkit" Bold 700, tracking -3.5%.
Wordmark text in the SVGs is converted to outlines, so no font install is needed.

svg/        Master vector files (logo, mark, icons). Transparent unless named on-light / on-dark.
png/        Raster exports of the above at common sizes.
platform/
  ios/      Full-bleed square icons (no rounding — iOS applies its own mask). Use icon-1024.png in Xcode / Expo.
  android/  Legacy mipmaps, Play Store 512, and adaptive-icon foreground + background colour.
  macos/    icon-1024.png with Apple's standard padding, plus FileToolkit.icns.
  windows/  FileToolkit.ico (16–256).
web/        favicon.ico, favicon.svg, apple-touch-icon.png, PWA icons 192/512.

Expo app.json hint:
  "icon": "./assets/platform/ios/icon-1024.png",
  "android": { "adaptiveIcon": { "foregroundImage": "./assets/platform/android/adaptive/ic_launcher_foreground-432.png",
                                 "backgroundColor": "#0F2236" } }
