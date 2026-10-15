import { FlashList, type FlashListProps, type FlashListRef } from '@shopify/flash-list';
import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { Animated, Pressable, StyleSheet, View, type GestureResponderEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { Icon, Txt } from './components';
import { radius, usePalette } from './theme';

const THUMB = 52;
const HIDE_AFTER_MS = 1400;

type Props<T> = Omit<FlashListProps<T>, 'onScroll' | 'ref'> & {
  /** Text for the bubble beside the fast-scroll thumb, for the item at that position (e.g. its group or first letter). */
  labelFor?: (item: T, index: number) => string | null;
  /** Show a "back to top" button once the list is scrolled a few screens down. */
  backToTop?: boolean;
  /** The fast scroller appears only when the list is at least this many screens long. */
  minScreens?: number;
  /** When this changes (e.g. a new search), the list jumps back to its first item. */
  resetKey?: string;
};

/** Scroll geometry, kept outside React state so scrolling never re-renders the list. */
interface Geometry {
  content: number;
  viewport: number;
  track: number;
  thumb: number;
  dragStart: number;
  dragging: boolean;
}

/**
 * A long list that stays quick: FlashList (rows are recycled, only what's on screen is drawn),
 * a fast scroller (drag the thumb on the right edge to jump anywhere, with a label bubble), and an
 * optional back-to-top button.
 */
export function FastList<T>({ labelFor, backToTop = false, minScreens = 3, resetKey, data, ...props }: Props<T>) {
  const c = usePalette();
  const list = useRef<FlashListRef<T>>(null);
  const geo = useRef<Geometry>({ content: 0, viewport: 0, track: 0, thumb: 0, dragStart: 0, dragging: false });
  const latest = useRef({ data, labelFor });
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [thumbY] = useState(() => new Animated.Value(0));
  const [opacity] = useState(() => new Animated.Value(0));
  const [long, setLong] = useState(false);
  const bubble = useRef<BubbleHandle>(null);
  const pendingIndex = useRef<{ index: number; at: number } | null>(null);
  const scrollFrame = useRef<number | null>(null);
  const [showTop, setShowTop] = useState(false);

  useEffect(() => {
    latest.current = { data, labelFor };
  });
  useEffect(
    () => () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      if (scrollFrame.current != null) cancelAnimationFrame(scrollFrame.current);
    },
    [],
  );

  const resetFrom = useRef(resetKey);
  useEffect(() => {
    if (resetFrom.current === resetKey) return;
    resetFrom.current = resetKey;
    // Wait a frame so the new rows are laid out before jumping.
    const frame = requestAnimationFrame(() => {
      if ((latest.current.data?.length ?? 0) > 0) list.current?.scrollToIndex({ index: 0, animated: false });
    });
    return () => cancelAnimationFrame(frame);
  }, [resetKey]);

  const maxOffset = () => Math.max(1, geo.current.content - geo.current.viewport);
  const maxThumb = () => Math.max(1, geo.current.track - THUMB);

  const setThumb = useCallback(
    (y: number) => {
      geo.current.thumb = y;
      thumbY.setValue(y);
    },
    [thumbY],
  );

  /** Shows the scroller, then fades it out once scrolling stops. */
  const reveal = useCallback(() => {
    Animated.timing(opacity, { toValue: 1, duration: 120, useNativeDriver: true }).start();
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (!geo.current.dragging) Animated.timing(opacity, { toValue: 0, duration: 300, useNativeDriver: true }).start();
    }, HIDE_AFTER_MS);
  }, [opacity]);

  const measure = (content: number, viewport: number) => {
    geo.current.content = content;
    geo.current.viewport = viewport;
    const isLong = viewport > 0 && content > viewport * minScreens;
    setLong((cur) => (cur === isLong ? cur : isLong));
  };

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    measure(contentSize.height, layoutMeasurement.height);
    if (!geo.current.dragging) setThumb((contentOffset.y / maxOffset()) * maxThumb());
    if (long) reveal();
    const top = contentOffset.y > layoutMeasurement.height * 1.5;
    setShowTop((cur) => (cur === top ? cur : top));
  };

  // Dragging the thumb: plain touch-responder handlers (event callbacks only).
  const endDrag = () => {
    geo.current.dragging = false;
    bubble.current?.show(null);
    reveal();
  };
  const drag = {
    onStartShouldSetResponder: () => true,
    onMoveShouldSetResponder: () => true,
    onResponderTerminationRequest: () => false,
    onResponderGrant: (e: GestureResponderEvent) => {
      geo.current.dragging = true;
      geo.current.dragStart = geo.current.thumb - e.nativeEvent.pageY;
      reveal();
    },
    onResponderMove: (e: GestureResponderEvent) => {
      const room = Math.max(1, geo.current.track - THUMB);
      const y = Math.min(room, Math.max(0, geo.current.dragStart + e.nativeEvent.pageY));
      setThumb(y);
      const ratio = y / room;
      const all = latest.current.data;
      const count = all?.length ?? 0;
      if (count === 0) return;
      // The item the same fraction of the way down the list: it's what the list jumps to and what the bubble names.
      const index = Math.min(count - 1, Math.round(ratio * (count - 1)));
      pendingIndex.current = { index, at: ratio };
      // Touch moves come faster than frames: jump once per frame, by index so the list draws exactly what's shown.
      if (scrollFrame.current == null) {
        scrollFrame.current = requestAnimationFrame(() => {
          scrollFrame.current = null;
          const target = pendingIndex.current;
          // The ends go all the way, past any list header or footer.
          if (!target) return;
          if (target.at === 0) list.current?.scrollToOffset({ offset: 0, animated: false });
          else if (target.at === 1) list.current?.scrollToEnd({ animated: false });
          else list.current?.scrollToIndex({ index: target.index, viewPosition: target.at, animated: false });
        });
      }
      const fn = latest.current.labelFor;
      if (fn && all) bubble.current?.show(fn(all[index], index));
    },
    onResponderRelease: endDrag,
    onResponderTerminate: endDrag,
  };

  return (
    <View
      style={styles.root}
      onLayout={(e) => {
        const h = e.nativeEvent.layout.height;
        geo.current.track = h - 16;
        measure(geo.current.content, h);
      }}
    >
      <FlashList
        {...props}
        ref={list}
        data={data}
        onScroll={onScroll}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={!long}
        onContentSizeChange={(_, h) => measure(h, geo.current.viewport)}
      />

      {long ? (
        <Animated.View pointerEvents="box-none" style={[styles.track, { opacity }]}>
          <Animated.View style={[styles.thumbArea, { transform: [{ translateY: thumbY }] }]} {...drag}>
            <Bubble ref={bubble} />
            <View style={[styles.thumb, { backgroundColor: c.lit }]} />
          </Animated.View>
        </Animated.View>
      ) : null}

      {backToTop && showTop ? (
        <Pressable
          onPress={() => list.current?.scrollToTop({ animated: true })}
          accessibilityRole="button"
          accessibilityLabel="Back to top"
          style={({ pressed }) => [styles.top, { backgroundColor: c.surface, borderColor: c.line, opacity: pressed ? 0.7 : 1 }]}
        >
          <Icon name="arrow-collapse-up" size={22} color={c.accent} />
        </Pressable>
      ) : null}
    </View>
  );
}

interface BubbleHandle {
  show: (label: string | null) => void;
}

/** The label beside the thumb, with its own state so changing it never re-renders the list. */
function Bubble({ ref }: { ref: Ref<BubbleHandle> }) {
  const c = usePalette();
  const [label, setLabel] = useState<string | null>(null);
  useImperativeHandle(ref, () => ({ show: (next) => setLabel((cur) => (cur === next ? cur : next)) }), []);
  if (!label) return null;
  return (
    <View pointerEvents="none" style={styles.bubbleAnchor}>
      <View style={[styles.bubble, { backgroundColor: c.ink }]}>
        <Txt v="smallStrong" color={c.bg} numberOfLines={1}>
          {label}
        </Txt>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  track: { position: 'absolute', top: 8, bottom: 8, right: 0, width: 32 },
  // A wide touch area around a slim visible thumb.
  thumbArea: { position: 'absolute', top: 0, right: 0, width: 32, height: THUMB, alignItems: 'flex-end', justifyContent: 'center', paddingRight: 4 },
  thumb: { width: 6, height: THUMB - 8, borderRadius: 3 },
  // The bubble needs its own wide box: absolutely placed inside the slim thumb area, its text would get no room.
  bubbleAnchor: { position: 'absolute', top: 0, bottom: 0, right: 40, width: 240, alignItems: 'flex-end', justifyContent: 'center' },
  bubble: {
    maxWidth: 240,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.md,
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  top: {
    position: 'absolute',
    right: 44,
    bottom: 16,
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
});
