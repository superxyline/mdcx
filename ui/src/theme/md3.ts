/**
 * Material Design 3 (Material You) 主题 token 与主题工厂.
 *
 * 这里只使用 MD3 的基线(baseline)色彩方案, 不接入动态取色(dynamic color),
 * 因为动态取色需要 Material Color Utilities 从壁纸提取种子色, 对影库类应用
 * 收益有限. 如需换肤, 替换下面两张色彩表即可.
 *
 * 参考: https://m3.material.io/styles/color/roles
 */

import { createTheme, type Theme } from "@mui/material/styles";

/** MD3 浅色基线色彩. */
export const md3LightColors = {
  primary: "#6750A4",
  onPrimary: "#FFFFFF",
  primaryContainer: "#EADDFF",
  onPrimaryContainer: "#21005D",

  secondary: "#625B71",
  onSecondary: "#FFFFFF",
  secondaryContainer: "#E8DEF8",
  onSecondaryContainer: "#1D192B",

  tertiary: "#7D5260",
  onTertiary: "#FFFFFF",
  tertiaryContainer: "#FFD8E4",
  onTertiaryContainer: "#31111D",

  error: "#B3261E",
  onError: "#FFFFFF",
  errorContainer: "#F9DEDC",
  onErrorContainer: "#410E0B",

  background: "#FEF7FF",
  onBackground: "#1D1B20",

  surface: "#FEF7FF",
  onSurface: "#1D1B20",
  surfaceVariant: "#E7E0EC",
  onSurfaceVariant: "#49454F",

  outline: "#79747E",
  outlineVariant: "#CAC4D0",

  // MD3 的 surface 层级, 越高的层级用于越"浮起"的容器
  surfaceContainerLowest: "#FFFFFF",
  surfaceContainerLow: "#F7F2FA",
  surfaceContainer: "#F3EDF7",
  surfaceContainerHigh: "#ECE6F0",
  surfaceContainerHighest: "#E6E0E9",
} as const;

/** MD3 深色基线色彩. */
export const md3DarkColors = {
  primary: "#D0BCFF",
  onPrimary: "#381E72",
  primaryContainer: "#4F378B",
  onPrimaryContainer: "#EADDFF",

  secondary: "#CCC2DC",
  onSecondary: "#332D41",
  secondaryContainer: "#4A4458",
  onSecondaryContainer: "#E8DEF8",

  tertiary: "#EFB8C8",
  onTertiary: "#492532",
  tertiaryContainer: "#633B48",
  onTertiaryContainer: "#FFD8E4",

  error: "#F2B8B5",
  onError: "#601410",
  errorContainer: "#8C1D18",
  onErrorContainer: "#F9DEDC",

  background: "#141218",
  onBackground: "#E6E0E9",

  surface: "#141218",
  onSurface: "#E6E0E9",
  surfaceVariant: "#49454F",
  onSurfaceVariant: "#CAC4D0",

  outline: "#938F99",
  outlineVariant: "#49454F",

  surfaceContainerLowest: "#0F0D13",
  surfaceContainerLow: "#1D1B20",
  surfaceContainer: "#211F26",
  surfaceContainerHigh: "#2B2930",
  surfaceContainerHighest: "#36343B",
} as const;

export type Md3Colors = typeof md3LightColors;

/** MD3 形状 token, 单位为 px. */
export const md3Shape = {
  none: 0,
  extraSmall: 4,
  small: 8,
  medium: 12,
  large: 16,
  extraLarge: 28,
  full: 9999,
} as const;

/** MD3 状态层(state layer)不透明度, 用于 hover / focus / pressed 叠加. */
export const md3StateLayer = {
  hover: 0.08,
  focus: 0.12,
  pressed: 0.12,
  dragged: 0.16,
} as const;

/** 中英文混排的字体栈, 优先使用系统 UI 字体. */
const fontFamily =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';

/**
 * MD3 排版阶梯.
 *
 * MD3 定义了 15 个角色(role), MUI 只有 13 个 variant, 因此做了就近映射:
 * h1-6 对应 display/headline 层级, subtitle 对应 title 层级,
 * caption/overline 对应 label 层级.
 */
const typography = {
  fontFamily,
  h1: { fontSize: "2.25rem", lineHeight: 1.222, fontWeight: 400, letterSpacing: 0 },
  h2: { fontSize: "2rem", lineHeight: 1.25, fontWeight: 400, letterSpacing: 0 },
  h3: { fontSize: "1.75rem", lineHeight: 1.286, fontWeight: 400, letterSpacing: 0 },
  h4: { fontSize: "1.5rem", lineHeight: 1.333, fontWeight: 400, letterSpacing: 0 },
  h5: { fontSize: "1.375rem", lineHeight: 1.273, fontWeight: 400, letterSpacing: 0 },
  h6: { fontSize: "1rem", lineHeight: 1.5, fontWeight: 500, letterSpacing: "0.009375em" },
  subtitle1: { fontSize: "1rem", lineHeight: 1.5, fontWeight: 500, letterSpacing: "0.009375em" },
  subtitle2: { fontSize: "0.875rem", lineHeight: 1.429, fontWeight: 500, letterSpacing: "0.00625em" },
  body1: { fontSize: "1rem", lineHeight: 1.5, fontWeight: 400, letterSpacing: "0.03125em" },
  body2: { fontSize: "0.875rem", lineHeight: 1.429, fontWeight: 400, letterSpacing: "0.015625em" },
  button: { fontSize: "0.875rem", lineHeight: 1.429, fontWeight: 500, letterSpacing: "0.00625em" },
  caption: { fontSize: "0.75rem", lineHeight: 1.333, fontWeight: 400, letterSpacing: "0.025em" },
  overline: { fontSize: "0.6875rem", lineHeight: 1.455, fontWeight: 500, letterSpacing: "0.03125em" },
};

export function createMd3Theme(mode: "light" | "dark"): Theme {
  const c: Md3Colors = mode === "dark" ? md3DarkColors : md3LightColors;

  return createTheme({
    palette: {
      mode,
      primary: { main: c.primary, contrastText: c.onPrimary },
      secondary: { main: c.secondary, contrastText: c.onSecondary },
      error: { main: c.error, contrastText: c.onError },
      background: { default: c.background, paper: c.surfaceContainerLow },
      text: { primary: c.onSurface, secondary: c.onSurfaceVariant },
      divider: c.outlineVariant,
    },
    shape: { borderRadius: md3Shape.medium },
    typography,
    components: {
      // MD3 的 filled button 是全圆角, 且不使用阴影
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: { borderRadius: md3Shape.full, paddingInline: 24, textTransform: "none" },
          contained: { boxShadow: "none", "&:hover": { boxShadow: "none" } },
        },
      },
      MuiIconButton: {
        styleOverrides: { root: { borderRadius: md3Shape.full } },
      },
      MuiPaper: {
        defaultProps: { elevation: 0 },
        styleOverrides: { root: { backgroundImage: "none" } },
      },
      MuiCard: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          root: {
            borderRadius: md3Shape.medium,
            backgroundColor: c.surfaceContainerLow,
            border: "none",
          },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: { borderRadius: md3Shape.extraLarge, padding: 8, backgroundColor: c.surfaceContainerHigh },
        },
      },
      MuiDialogTitle: { styleOverrides: { root: { fontSize: "1.5rem", fontWeight: 400 } } },
      MuiTextField: { defaultProps: { variant: "outlined" } },
      MuiOutlinedInput: {
        styleOverrides: {
          root: { borderRadius: md3Shape.extraSmall },
        },
      },
      MuiListItemButton: {
        styleOverrides: { root: { borderRadius: md3Shape.full, marginInline: 8 } },
      },
      MuiAppBar: {
        defaultProps: { elevation: 0, color: "default" },
        styleOverrides: {
          root: { backgroundColor: c.surfaceContainer, color: c.onSurface },
        },
      },
      MuiDrawer: {
        styleOverrides: {
          paper: { backgroundColor: c.surfaceContainerLow, border: "none" },
        },
      },
      MuiChip: {
        styleOverrides: { root: { borderRadius: md3Shape.small } },
      },
      // MD3 的标签页不使用全大写
      MuiTab: {
        styleOverrides: { root: { textTransform: "none", fontSize: "0.875rem", fontWeight: 500 } },
      },
      MuiLinearProgress: {
        styleOverrides: {
          root: { borderRadius: md3Shape.full, height: 4 },
        },
      },
      MuiTooltip: {
        styleOverrides: {
          tooltip: { borderRadius: md3Shape.extraSmall, fontSize: "0.75rem" },
        },
      },
    },
  });
}
