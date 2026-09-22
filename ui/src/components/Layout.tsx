import {
  Article,
  Brightness4,
  Brightness7,
  BrightnessAuto,
  Build,
  ChevronLeft,
  ChevronRight,
  Home,
  Info,
  Lan,
  Menu,
  Settings,
  ShieldOutlined,
} from "@mui/icons-material";
import {
  Alert,
  Box,
  CssBaseline,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  AppBar as MuiAppBar,
  type AppBarProps as MuiAppBarProps,
  styled,
  Toolbar,
  Typography,
} from "@mui/material";
import { Link } from "@tanstack/react-router";
import { type ReactNode, useEffect, useState } from "react";
import { getScrapeStatus } from "@/client/sdk.gen";
import { useTheme } from "@/hooks/useTheme";
import type { FileRouteTypes } from "@/routeTree.gen";

const drawerWidth = 240;
const collapsedDrawerWidth = 60;

const Main = styled("main", { shouldForwardProp: (prop) => prop !== "open" })(({ theme }) => ({
  flexGrow: 1,
  padding: theme.spacing(3),
  transition: theme.transitions.create("margin", {
    easing: theme.transitions.easing.sharp,
    duration: theme.transitions.duration.leavingScreen,
  }),
  marginLeft: 0,
}));

interface AppBarProps extends MuiAppBarProps {
  open?: boolean;
}

const AppBar = styled(MuiAppBar, {
  shouldForwardProp: (prop) => prop !== "open",
})<AppBarProps>(({ theme, open }) => ({
  transition: theme.transitions.create(["margin", "width"], {
    easing: theme.transitions.easing.sharp,
    duration: theme.transitions.duration.leavingScreen,
  }),
  ...(open && {
    width: `calc(100% - ${drawerWidth}px)`,
    marginLeft: `${drawerWidth}px`,
    transition: theme.transitions.create(["margin", "width"], {
      easing: theme.transitions.easing.easeOut,
      duration: theme.transitions.duration.enteringScreen,
    }),
  }),
}));

const DrawerHeader = styled("div")(({ theme }) => ({
  display: "flex",
  alignItems: "center",
  padding: theme.spacing(0, 1),
  // necessary for content to be below app bar
  ...theme.mixins.toolbar,
  justifyContent: "flex-end",
}));

const createMenuItems = <
  T extends readonly {
    text: string;
    to: FileRouteTypes["to"];
    icon: ReactNode;
  }[],
>(
  items: T,
) => items;

export default function Layout({ children }: { children: ReactNode }) {
  const { mode, setMode } = useTheme();
  const [open, setOpen] = useState(true);
  // 接口认证未开启时提示用户去设置 MDCX_API_KEY (auth_enabled 来自刮削状态接口)
  const [authDisabled, setAuthDisabled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // 模块加载时 apiKey.ts 已把 localStorage Key 注入 client;
    // 这里不 throw, 401 交给根路由处理
    getScrapeStatus()
      .then((res) => {
        if (cancelled) return;
        const data = res.data as { auth_enabled?: boolean } | undefined;
        if (data && data.auth_enabled === false) {
          setAuthDisabled(true);
        }
      })
      .catch(() => {
        /* 认证已开启且 Key 未就绪时可能 401, 由根路由处理跳转 */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleThemeChange = () => {
    const newMode = mode === "light" ? "dark" : mode === "dark" ? "system" : "light";
    setMode(newMode);
  };

  const menuItems = createMenuItems([
    { text: "首页", to: "/", icon: <Home /> },
    { text: "工具箱", to: "/tool", icon: <Build /> },
    { text: "网络", to: "/network", icon: <Lan /> },
    { text: "日志", to: "/logs", icon: <Article /> },
    { text: "设置", to: "/settings", icon: <Settings /> },
    { text: "关于", to: "/about", icon: <Info /> },
  ]);

  return (
    <Box sx={{ display: "flex" }}>
      <CssBaseline />
      <AppBar position="fixed">
        <Toolbar>
          <IconButton
            color="inherit"
            aria-label="open drawer"
            onClick={() => setOpen(!open)}
            edge="start"
            sx={{ mr: 2 }}
          >
            <Menu />
          </IconButton>
          <Typography variant="h6" noWrap component="div" sx={{ flexGrow: 1 }}>
            MDCx 影片元数据刮削
          </Typography>
          <IconButton color="inherit" onClick={handleThemeChange}>
            {mode === "light" ? <Brightness7 /> : mode === "dark" ? <Brightness4 /> : <BrightnessAuto />}
          </IconButton>
        </Toolbar>
      </AppBar>
      <Drawer
        sx={{
          width: open ? drawerWidth : collapsedDrawerWidth,
          flexShrink: 0,
          "& .MuiDrawer-paper": {
            width: open ? drawerWidth : collapsedDrawerWidth,
            boxSizing: "border-box",
            transition: "width 0.2s",
          },
        }}
        variant="persistent"
        anchor="left"
        open={true}
      >
        <DrawerHeader>
          <IconButton onClick={() => setOpen(!open)}>{open ? <ChevronLeft /> : <ChevronRight />}</IconButton>
        </DrawerHeader>
        <Divider />
        <List>
          {menuItems.map((item) => (
            <ListItem key={item.to} disablePadding>
              <ListItemButton component={Link} to={item.to} activeProps={{ style: { fontWeight: "bold" } }}>
                <ListItemIcon>{item.icon}</ListItemIcon>
                <ListItemText primary={item.text} sx={{ opacity: open ? 1 : 0 }} />
              </ListItemButton>
            </ListItem>
          ))}
        </List>
      </Drawer>
      <Main>
        <DrawerHeader />
        {authDisabled ? (
          <Alert
            severity="warning"
            icon={<ShieldOutlined />}
            sx={{ mb: 2 }}
            action={
              <IconButton color="inherit" size="small" component={Link} to="/settings" aria-label="去设置">
                <Settings fontSize="inherit" />
              </IconButton>
            }
          >
            接口认证未开启：局域网内任意设备都可读写本机文件。请在 docker-compose 中设置{" "}
            <Typography component="span" variant="body2" sx={{ fontFamily: "monospace", fontWeight: 600 }}>
              MDCX_API_KEY
            </Typography>{" "}
            后重启容器；设置说明见 设置 → 代理与网络。
          </Alert>
        ) : null}
        {children}
      </Main>
    </Box>
  );
}
