import { Image } from 'expo-image';
import { router, type Href } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { Pressable, ScrollView, StyleSheet, View, useColorScheme } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { readLastPath } from '@/lib/lastTool';
import { TOOL_GROUPS, availableTools, type Tool } from '@/tools';
import { DeviceChip, Icon, IconTile, SectionLabel, Txt, radius, usePalette, useToolTint } from '@/ui';

const logoLight = require('../../assets/brand/logo-on-light.png');
const logoDark = require('../../assets/brand/logo-on-dark.png');

/** Home: every tool, by section. Reopens the tool that was open last time. */
export default function Home() {
  const c = usePalette();
  const insets = useSafeAreaInsets();
  const dark = useColorScheme() === 'dark';

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
      contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: insets.bottom + 24, paddingHorizontal: 16, gap: 22 }}
    >
      <View style={styles.top}>
        {/* The artwork's background is the app background, so the logo sits flush. */}
        <Image source={dark ? logoDark : logoLight} style={styles.logo} contentFit="contain" accessibilityLabel="FileToolkit" />
        <DeviceChip />
      </View>

      <View style={{ gap: 8, paddingHorizontal: 4 }}>
        <Txt v="display">Tidy your phone, one tool at a time.</Txt>
        <Txt v="body" color={c.muted}>
          Clean up photos and videos, give folders and files sensible names, and zip or unzip archives. Everything runs on this device.
        </Txt>
      </View>

      {TOOL_GROUPS.map((group) => {
        const tools = availableTools().filter((t) => t.group === group);
        if (tools.length === 0) return null;
        return (
          <View key={group} style={{ gap: 10 }}>
            <SectionLabel>{group}</SectionLabel>
            {tools.map((tool) => (
              <ToolCard key={tool.key} tool={tool} />
            ))}
          </View>
        );
      })}
    </ScrollView>
  );
}

function ToolCard({ tool }: { tool: Tool }) {
  const c = usePalette();
  const tint = useToolTint(tool.key);
  return (
    <Pressable
      onPress={() => router.push(tool.route as Href)}
      accessibilityRole="button"
      accessibilityLabel={tool.title}
      accessibilityHint={tool.summary}
      style={({ pressed }) => [styles.card, { backgroundColor: c.surface, borderColor: c.line, opacity: pressed ? 0.7 : 1 }]}
    >
      <IconTile name={tool.icon} tint={tint} size={48} />
      <View style={{ flex: 1, gap: 2 }}>
        <Txt v="heading">{tool.title}</Txt>
        <Txt v="small" color={c.muted}>
          {tool.summary}
        </Txt>
      </View>
      <Icon name="chevron-right" size={22} color={c.faint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  // logo-on-*.png is 1200×315 including its own padding.
  logo: { width: 183, height: 48, marginLeft: -12 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 14,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
