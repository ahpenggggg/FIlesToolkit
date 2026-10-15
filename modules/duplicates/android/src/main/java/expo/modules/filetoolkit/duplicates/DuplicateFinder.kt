package expo.modules.filetoolkit.duplicates

import expo.modules.filetoolkit.medialibrary.MediaItem
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

data class GroupMember(val item: MediaItem, val similarity: Int)

/** [members] first entry is the item kept by default (best quality). [id] = that keeper's MediaStore id. */
data class DupGroup(val id: Long, val members: List<GroupMember>) {
    val isVideo: Boolean get() = members.first().item.isVideo
}

object DuplicateFinder {

    /**
     * Two groups are NOT merged if the link between them is this much weaker than how tight they are internally.
     * E.g. A≈A' at 96% and B≈B' at 99%, but A≈B only 86% → 96−86 = 10 > 5 → kept as two groups.
     */
    private const val SPLIT_GAP = 0.05

    // Best copy first: highest resolution, then largest file, then oldest (most likely the original).
    private val bestFirst = compareByDescending<MediaItem> { it.width.toLong() * it.height }
        .thenByDescending { it.size }
        .thenBy { it.dateTaken.takeIf { t -> t > 0 } ?: (it.dateModified * 1000) }

    fun find(
        entries: List<Pair<MediaItem, Signature>>,
        threshold: Double,
        onProgress: (done: Int, total: Int) -> Unit,
    ): List<DupGroup> {
        val usable = entries.filter { it.second.usable }
        val photos = usable.filter { !it.first.isVideo }
        val videos = usable.filter { it.first.isVideo }
        val total = usable.size
        val groups = cluster(photos, threshold) { onProgress(it, total) } +
            cluster(videos, threshold) { onProgress(photos.size + it, total) }
        onProgress(total, total)
        return groups.sortedByDescending { g ->
            val k = g.members.first().item
            k.dateTaken.takeIf { it > 0 } ?: (k.dateModified * 1000)
        }
    }

    /**
     * Agglomerative clustering, closest pairs first (complete linkage):
     *  1. Score every pair; keep those ≥ threshold.
     *  2. Walk pairs from most to least similar, merging their groups only if
     *     a) EVERY item in the merged group is ≥ threshold similar to every other (no chains), and
     *     b) the link isn't much weaker than the groups' own tightness ([SPLIT_GAP]),
     *        so copies of A stay with A and copies of B stay with B.
     *  3. In each group the best-quality item is the keeper; all others are directly ≥ threshold to it.
     */
    private fun cluster(
        list: List<Pair<MediaItem, Signature>>,
        threshold: Double,
        progress: (Int) -> Unit,
    ): List<DupGroup> {
        val n = list.size
        if (n < 2) return emptyList()

        // ---- 1. pair scores ----
        val sims = HashMap<Long, Double>()
        val pairs = ArrayList<Triple<Int, Int, Double>>()
        for (i in 0 until n) {
            if (i % 50 == 0) progress(i)
            val (a, sa) = list[i]
            for (j in i + 1 until n) {
                val (b, sb) = list[j]
                if (!shapesMatch(a, b)) continue
                if (a.isVideo && !durationsMatch(a, b)) continue
                val s = sa.similarity(sb, threshold)
                if (s >= threshold) {
                    sims[key(i, j, n)] = s
                    pairs += Triple(i, j, s)
                }
            }
        }
        if (pairs.isEmpty()) return emptyList()
        pairs.sortByDescending { it.third }

        // ---- 2. merge closest first ----
        val clusterOf = IntArray(n) { it }
        val members = HashMap<Int, MutableList<Int>>()
        val tightness = HashMap<Int, Double>()   // weakest internal link; absent = singleton
        fun membersOf(c: Int) = members.getOrPut(c) { mutableListOf(c) }

        for ((i, j, _) in pairs) {
            val ci = clusterOf[i]
            val cj = clusterOf[j]
            if (ci == cj) continue
            val mi = membersOf(ci)
            val mj = membersOf(cj)

            // Weakest link between the two groups; a missing pair means < threshold → can't merge.
            var cross = 1.0
            loop@ for (x in mi) {
                for (y in mj) {
                    val s = sims[key(x, y, n)]
                    if (s == null) { cross = -1.0; break@loop }
                    if (s < cross) cross = s
                }
            }
            if (cross < threshold) continue

            val ti = tightness[ci]
            val tj = tightness[cj]
            val tight = listOfNotNull(ti, tj).minOrNull()
            if (tight != null && tight - cross > SPLIT_GAP) continue

            // merge cj into ci
            mi.addAll(mj)
            for (y in mj) clusterOf[y] = ci
            members.remove(cj)
            tightness.remove(cj)
            tightness[ci] = minOf(cross, ti ?: 1.0, tj ?: 1.0)
        }

        // ---- 3. build groups ----
        val out = ArrayList<DupGroup>()
        for ((_, idx) in members) {
            if (idx.size < 2) continue
            val sorted = idx.sortedWith(compareBy(bestFirst) { list[it].first })
            val keeper = sorted.first()
            val keeperItem = list[keeper].first
            val gm = ArrayList<GroupMember>(sorted.size)
            gm += GroupMember(keeperItem, 100)
            for (o in sorted.drop(1)) {
                val s = sims[key(keeper, o, n)] ?: threshold
                gm += GroupMember(list[o].first, (s * 100).roundToInt())
            }
            out += DupGroup(keeperItem.id, gm)
        }
        return out
    }

    private fun key(a: Int, b: Int, n: Int): Long {
        val lo = min(a, b)
        val hi = max(a, b)
        return lo.toLong() * n + hi
    }

    /** Same aspect ratio (±12%), orientation-agnostic. Different shapes = different picture or a heavy crop. */
    private fun shapesMatch(a: MediaItem, b: MediaItem): Boolean {
        if (a.width <= 0 || a.height <= 0 || b.width <= 0 || b.height <= 0) return true
        val ra = max(a.width, a.height).toDouble() / min(a.width, a.height)
        val rb = max(b.width, b.height).toDouble() / min(b.width, b.height)
        return abs(ra - rb) / max(ra, rb) <= 0.12
    }

    private fun durationsMatch(a: MediaItem, b: MediaItem): Boolean {
        val x = a.durationMs
        val y = b.durationMs
        if (x <= 0 || y <= 0) return true
        return abs(x - y) <= max(1500L, max(x, y) / 10)
    }
}
