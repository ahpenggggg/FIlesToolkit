import { Image } from 'expo-image';
import { router, type Href } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View, useColorScheme, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { readLastPath } from '@/lib/lastTool';
import { useRunningTool } from '@/lib/tasks';
import { TOOL_GROUPS, availableTools, type Tool } from '@/tools';
import { DeviceChip, IconTile, Txt, radius, usePalette, useToolTint } from '@/ui';

const logoLight = require('../../assets/brand/logo-on-light.png');
const logoDark = require('../../assets/brand/logo-on-dark.png');

const PAD = 16;
const GAP = 12;

/** Home: a grid of tools, kept together by group. Reopens the tool that was open last time. */
export default function Home() {
  const c = usePalette();
  const insets = useSafeAreaInsets();
  const dark = useColorScheme() === 'dark';
  const { width } = useWindowDimensions();
  const tileWidth = Math.floor((width - PAD * 2 - GAP) / 2);
  // Grouped tools sit side by side; what each does is in the info tip on its screen.
  const running = useRunningTool();
  const tools = [...availableTools()].sort((a, b) => TOOL_GROUPS.indexOf(a.group) - TOOL_GROUPS.indexOf(b.group));

  useEffect(() => {
    readLastPath()
      .then((path) => {
        if (path && availableTools().some((t) => t.route === path)) router.push(path as Href);
      })
      .finally(() => SplashScreen.hideAsync().catch(() => {}));
  }, []);

  return (
    <ScrollView
      style={{ backgroundColor: c.bg }}
      contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: insets.bottom + 24, paddingHorizontal: PAD, gap: 20 }}
    >
      <View style={styles.top}>
        {/* The artwork's background is the app background, so the logo sits flush. */}
        <Image source={dark ? logoDark : logoLight} style={styles.logo} contentFit="contain" accessibilityLabel="FileToolkit" />
        <DeviceChip />
      </View>

      <View style={styles.grid}>
        {tools.map((tool) => (
          <ToolTile key={tool.key} tool={tool} width={tileWidth} running={running === tool.key} />
        ))}
      </View>
    </ScrollView>
  );
}

function ToolTile({ tool, width, running }: { tool: Tool; width: number; running: boolean }) {
  const c = usePalette();
  const tint = useToolTint(tool.key);
  return (
    <Pressable
      onPress={() => router.push(tool.route as Href)}
      accessibilityRole="button"
      accessibilityLabel={tool.title}
      accessibilityHint={running ? 'Running a task' : tool.summary}
      style={({ pressed }) => [styles.tile, { width, backgroundColor: c.surface, borderColor: running ? tint : c.line, borderWidth: running ? 1.5 : StyleSheet.hairlineWidth, opacity: pressed ? 0.7 : 1 }]}
    >
      <View style={styles.tileTop}>
        <IconTile name={tool.icon} tint={tint} size={44} />
        {running ? (
          <View style={styles.running}>
            <ActivityIndicator size="small" color={tint} />
            <Txt v="caption" color={tint} style={{ fontWeight: '700' }}>
              Running
            </Txt>
          </View>
        ) : null}
      </View>
      <Txt v="heading" numberOfLines={2}>
        {tool.title}
      </Txt>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  // logo-on-*.png is 1200×315 including its own padding.
  logo: { width: 183, height: 48, marginLeft: -12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  tileTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  running: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  tile: {
    minHeight: 120,
    justifyContent: 'space-between',
    gap: 16,
    padding: 16,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
