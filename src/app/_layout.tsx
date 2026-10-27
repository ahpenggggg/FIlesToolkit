import { Tabs, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { rememberPath } from '@/lib/lastTool';
import { PermissionGate } from '@/shell/PermissionGate';
import { usePalette } from '@/ui';

// The home screen hides the splash once it has reopened the tool used last.
SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const c = usePalette();
  const pathname = usePathname();

  useEffect(() => rememberPath(pathname), [pathname]);

  // Safety net, e.g. when the app is opened straight into a tool by a link.
  useEffect(() => {
    const timer = setTimeout(() => SplashScreen.hideAsync().catch(() => {}), 3000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      {/*
        Tabs without a tab bar: each tool's screen stays mounted once opened, so a running task and its
        progress are still there after going home and back. Back always returns to the home screen.
      */}
      <Tabs
        backBehavior="initialRoute"
        tabBar={() => null}
        screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: c.bg }, animation: 'shift', freezeOnBlur: true }}
      />
      <PermissionGate />
    </SafeAreaProvider>
  );
}
