import { Stack, usePathname } from 'expo-router';
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
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg }, animation: 'slide_from_right' }} />
      <PermissionGate />
    </SafeAreaProvider>
  );
}
