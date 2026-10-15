import CoreGraphics
import Foundation

// Port of Hashing.kt + DuplicateFinder.kt so iOS groups exactly like Android.

/// One image / video frame: 256-bit DCT perceptual hash (structure) + 8x8 RGB thumbnail (colour).
struct FrameFeature {
  let phash: [UInt64]  // 4 words
  let color: [UInt8]   // 192 bytes

  /// Calibrated: unrelated images differ in ~128 of 256 bits → 0%; identical → 100%.
  func structure(_ o: FrameFeature) -> Double {
    var d = 0
    for i in 0..<4 { d += (phash[i] ^ o.phash[i]).nonzeroBitCount }
    return max(0, 1 - Double(d) / 128)
  }

  /// Mean absolute RGB difference: 0 → 100%, ≥ 48 → 0%.
  func colour(_ o: FrameFeature) -> Double {
    var sum = 0
    for i in 0..<192 { sum += abs(Int(color[i]) - Int(o.color[i])) }
    return max(0, 1 - Double(sum) / 192 / 48)
  }

  func similarity(_ o: FrameFeature) -> Double { min(structure(o), colour(o)) }

  func encode() -> String {
    phash.map { String($0, radix: 16) }.joined(separator: ".") + ":" + Data(color).base64EncodedString()
  }

  static func decode(_ s: Substring) -> FrameFeature? {
    let parts = s.split(separator: ":", maxSplits: 1)
    guard parts.count == 2 else { return nil }
    let words = parts[0].split(separator: ".").compactMap { UInt64($0, radix: 16) }
    guard words.count == 4, let data = Data(base64Encoded: String(parts[1])), data.count == 192 else { return nil }
    return FrameFeature(phash: words, color: [UInt8](data))
  }
}

enum PerceptualHash {
  private static let n = 64
  private static let k = 16
  private static let cosTable: [[Double]] = (0..<k).map { u in
    (0..<n).map { x in cos(Double(2 * x + 1) * Double(u) * Double.pi / Double(2 * n)) }
  }

  /// nil for near-uniform images (black pocket shots, blank screens).
  static func feature(_ image: CGImage) -> FrameFeature? {
    guard let px = rgba(image, size: n) else { return nil }
    var g = [Double](repeating: 0, count: n * n)
    for i in 0..<(n * n) {
      g[i] = 0.299 * Double(px[i * 4]) + 0.587 * Double(px[i * 4 + 1]) + 0.114 * Double(px[i * 4 + 2])
    }
    let mean = g.reduce(0, +) / Double(g.count)
    let std = sqrt(g.reduce(0) { $0 + ($1 - mean) * ($1 - mean) } / Double(g.count))
    if std < 6 { return nil }

    var tmp = [[Double]](repeating: [Double](repeating: 0, count: n), count: k)
    for u in 0..<k {
      let cu = cosTable[u]
      for y in 0..<n {
        var s = 0.0
        let row = y * n
        for x in 0..<n { s += cu[x] * g[row + x] }
        tmp[u][y] = s
      }
    }
    var d = [Double](repeating: 0, count: k * k)
    for u in 0..<k {
      let tu = tmp[u]
      for v in 0..<k {
        let cv = cosTable[v]
        var s = 0.0
        for y in 0..<n { s += cv[y] * tu[y] }
        d[v * k + u] = s
      }
    }
    let median = Array(d[1...]).sorted()[(k * k - 1) / 2]
    var bits = [UInt64](repeating: 0, count: 4)
    for i in 0..<(k * k) where d[i] > median { bits[i / 64] |= (UInt64(1) << UInt64(i % 64)) }

    guard let tiny = rgba(image, size: 8) else { return nil }
    var color = [UInt8](repeating: 0, count: 192)
    for i in 0..<64 {
      color[i * 3] = tiny[i * 4]
      color[i * 3 + 1] = tiny[i * 4 + 1]
      color[i * 3 + 2] = tiny[i * 4 + 2]
    }
    return FrameFeature(phash: bits, color: color)
  }

  /// Draws [image] squashed into size×size RGBA (like Bitmap.createScaledBitmap).
  private static func rgba(_ image: CGImage, size: Int) -> [UInt8]? {
    var px = [UInt8](repeating: 0, count: size * size * 4)
    let ok: Bool = px.withUnsafeMutableBytes { buf in
      guard let ctx = CGContext(
        data: buf.baseAddress, width: size, height: size, bitsPerComponent: 8, bytesPerRow: size * 4,
        space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue
      ) else { return false }
      ctx.interpolationQuality = .high
      ctx.draw(image, in: CGRect(x: 0, y: 0, width: size, height: size))
      return true
    }
    return ok ? px : nil
  }
}

/// 1 frame for a photo, several sampled frames for a video. nil = unusable frame.
struct Signature {
  let frames: [FrameFeature?]

  var usable: Bool { frames.contains { $0 != nil } }

  func similarity(_ other: Signature, floor: Double = 0) -> Double {
    if frames.count == 1 && other.frames.count == 1 {
      guard let a = frames[0], let b = other.frames[0] else { return 0 }
      let s = a.structure(b)
      return s < floor ? s : min(s, a.colour(b))
    }
    var scores: [Double] = []
    for i in 0..<min(frames.count, other.frames.count) {
      if let a = frames[i], let b = other.frames[i] { scores.append(a.similarity(b)) }
    }
    let required = (frames.count > 1 && other.frames.count > 1) ? 2 : 1
    guard scores.count >= required, let lo = scores.min() else { return 0 }
    let avg = scores.reduce(0, +) / Double(scores.count)
    return min(avg, lo + 0.10)
  }

  func encode() -> String { frames.map { $0?.encode() ?? "-" }.joined(separator: ",") }

  static func decode(_ s: String) -> Signature? {
    var out: [FrameFeature?] = []
    for part in s.split(separator: ",", omittingEmptySubsequences: false) {
      if part == "-" { out.append(nil); continue }
      guard let f = FrameFeature.decode(part) else { return nil }
      out.append(f)
    }
    return out.isEmpty ? nil : Signature(frames: out)
  }
}

/// What grouping needs to know about an asset.
struct ScanItem {
  let id: String
  let isVideo: Bool
  let width: Int
  let height: Int
  let size: Int64
  let date: Double       // ms
  let durationMs: Double
  let info: [String: Any] // JS-facing asset map
}

struct Group {
  let members: [(item: ScanItem, similarity: Int)]
}

enum DuplicateFinder {
  private static let splitGap = 0.05

  static func find(_ entries: [(ScanItem, Signature)], threshold: Double, progress: (Int, Int) -> Void) -> [Group] {
    let usable = entries.filter { $0.1.usable }
    let photos = usable.filter { !$0.0.isVideo }
    let videos = usable.filter { $0.0.isVideo }
    let total = usable.count
    let groups = cluster(photos, threshold) { progress($0, total) } + cluster(videos, threshold) { progress(photos.count + $0, total) }
    progress(total, total)
    return groups.sorted { $0.members[0].item.date > $1.members[0].item.date }
  }

  private static func better(_ a: ScanItem, _ b: ScanItem) -> Bool {
    let pa = Int64(a.width) * Int64(a.height), pb = Int64(b.width) * Int64(b.height)
    if pa != pb { return pa > pb }
    if a.size != b.size { return a.size > b.size }
    return a.date < b.date
  }

  private static func cluster(_ list: [(ScanItem, Signature)], _ threshold: Double, _ progress: (Int) -> Void) -> [Group] {
    let n = list.count
    if n < 2 { return [] }
    var sims: [Int: Double] = [:]
    var pairs: [(Int, Int, Double)] = []
    func key(_ a: Int, _ b: Int) -> Int { min(a, b) * n + max(a, b) }

    for i in 0..<n {
      if i % 50 == 0 { progress(i) }
      let (a, sa) = list[i]
      for j in (i + 1)..<n where j < n {
        let (b, sb) = list[j]
        if !shapesMatch(a, b) { continue }
        if a.isVideo && !durationsMatch(a, b) { continue }
        let s = sa.similarity(sb, floor: threshold)
        if s >= threshold {
          sims[key(i, j)] = s
          pairs.append((i, j, s))
        }
      }
    }
    if pairs.isEmpty { return [] }
    pairs.sort { $0.2 > $1.2 }

    var clusterOf = Array(0..<n)
    var members: [Int: [Int]] = [:]
    var tightness: [Int: Double] = [:]

    for (i, j, _) in pairs {
      let ci = clusterOf[i], cj = clusterOf[j]
      if ci == cj { continue }
      let mi = members[ci] ?? [ci]
      let mj = members[cj] ?? [cj]
      var cross = 1.0
      outer: for x in mi {
        for y in mj {
          guard let s = sims[key(x, y)] else { cross = -1; break outer }
          if s < cross { cross = s }
        }
      }
      if cross < threshold { continue }
      let ti = tightness[ci], tj = tightness[cj]
      if let tight = [ti, tj].compactMap({ $0 }).min(), tight - cross > splitGap { continue }

      members[ci] = mi + mj
      for y in mj { clusterOf[y] = ci }
      members[cj] = nil
      tightness[cj] = nil
      tightness[ci] = min(cross, ti ?? 1, tj ?? 1)
    }

    var out: [Group] = []
    for (_, idx) in members where idx.count >= 2 {
      let sorted = idx.sorted { better(list[$0].0, list[$1].0) }
      let keeper = sorted[0]
      var gm: [(item: ScanItem, similarity: Int)] = [(list[keeper].0, 100)]
      for o in sorted.dropFirst() {
        let s = sims[key(keeper, o)] ?? threshold
        gm.append((list[o].0, Int((s * 100).rounded())))
      }
      out.append(Group(members: gm))
    }
    return out
  }

  private static func shapesMatch(_ a: ScanItem, _ b: ScanItem) -> Bool {
    if a.width <= 0 || a.height <= 0 || b.width <= 0 || b.height <= 0 { return true }
    let ra = Double(max(a.width, a.height)) / Double(min(a.width, a.height))
    let rb = Double(max(b.width, b.height)) / Double(min(b.width, b.height))
    return abs(ra - rb) / max(ra, rb) <= 0.12
  }

  private static func durationsMatch(_ a: ScanItem, _ b: ScanItem) -> Bool {
    let x = a.durationMs, y = b.durationMs
    if x <= 0 || y <= 0 { return true }
    return abs(x - y) <= max(1500, max(x, y) / 10)
  }
}

/// On-disk cache so rescans only fingerprint new or changed assets.
final class HashCache {
  private let url: URL
  private var map: [String: String] = [:]
  private let lock = NSLock()

  init(url: URL) { self.url = url }

  func load() {
    guard let text = try? String(contentsOf: url, encoding: .utf8) else { return }
    for line in text.split(separator: "\n") {
      guard let tab = line.firstIndex(of: "\t") else { continue }
      map[String(line[..<tab])] = String(line[line.index(after: tab)...])
    }
  }

  func get(_ key: String) -> Signature? {
    lock.lock(); defer { lock.unlock() }
    return map[key].flatMap(Signature.decode)
  }

  func put(_ key: String, _ sig: Signature) {
    lock.lock(); defer { lock.unlock() }
    map[key] = sig.encode()
  }

  func prune(keep: Set<String>) {
    lock.lock(); defer { lock.unlock() }
    map = map.filter { keep.contains($0.key) }
  }

  func save() {
    lock.lock(); defer { lock.unlock() }
    let text = map.map { "\($0.key)\t\($0.value)" }.joined(separator: "\n")
    try? text.write(to: url, atomically: true, encoding: .utf8)
  }
}
