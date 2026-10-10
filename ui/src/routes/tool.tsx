import {
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  InputLabel,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { WebsiteSchema } from "@/client/schemas.gen";
import {
  addSubtitlesMutation,
  checkCookieMutation,
  checkMissingNumbersMutation,
  cleanFilesMutation,
  clearSuccessListMutation,
  completeActorsMutation,
  createSymlinkMutation,
  getFailedListOptions,
  getHealthReportOptions,
  getScrapeLeftoversOptions,
  getSiteUrlsOptions,
  getSuccessListOptions,
  listActorsMutation,
  manageExtrafanartCopyMutation,
  manageExtrasMutation,
  manageKodiActorsMutation,
  manageThemeVideosMutation,
  moveVideosMutation,
  retryFailedListMutation,
  saveSuccessListMutation,
  scanDuplicatesOptions,
  scrapeSingleFileMutation,
  setSiteUrlMutation,
  startScrapeMutation,
} from "../client/@tanstack/react-query.gen";
import { cleanScrapeLeftovers, deleteDuplicates } from "../client/sdk.gen";
import type { DuplicatesResponse, HealthReport, LeftoversResponse, Website } from "../client/types.gen";
import { PosterCutter } from "../components/PosterCutter";
import { useToast } from "../contexts/ToastProvider";

export const Route = createFileRoute("/tool")({
  // 支持从刮削结果详情跳转过来时预填封面裁剪器的图片路径: /tool?cutterPath=...
  validateSearch: (search: Record<string, unknown>): { cutterPath?: string } => ({
    cutterPath: typeof search.cutterPath === "string" && search.cutterPath ? search.cutterPath : undefined,
  }),
  component: ToolComponent,
});

/** 需要二次确认的破坏性操作. */
interface PendingConfirm {
  title: string;
  content: string;
  confirmText: string;
  action: () => void;
}

function ToolComponent() {
  const navigate = useNavigate();
  const { showSuccess, showError, showInfo } = useToast();

  // 开始刮削
  const startScrape = useMutation(startScrapeMutation());

  // 单文件刮削
  const [singleFilePath, setSingleFilePath] = useState("");
  const [singleFileUrl, setSingleFileUrl] = useState("");
  const scrapeSingleFile = useMutation(scrapeSingleFileMutation());

  // 创建软链接
  const [sourceDir, setSourceDir] = useState("");
  const [destDir, setDestDir] = useState("");
  const [copyFiles, setCopyFiles] = useState(false);
  const createSymlink = useMutation(createSymlinkMutation());

  // 添加字幕
  const addSubtitles = useMutation(addSubtitlesMutation());

  // 演员相关
  const completeActors = useMutation(completeActorsMutation());

  // Cookie 检查(按站点分别检测)
  const [cookieSite, setCookieSite] = useState<"javbus" | "javdb">("javbus");
  const checkCookie = useMutation(checkCookieMutation());
  const [cookieResult, setCookieResult] = useState<{ ok: boolean; message: string } | null>(null);

  // 设置网站网址
  const [site, setSite] = useState<Website>("javdb");
  const [siteUrl, setSiteUrl] = useState("");
  const setSiteUrlMut = useMutation(setSiteUrlMutation());
  const currentSiteUrl = useQuery(getSiteUrlsOptions());
  const currentUrls = currentSiteUrl.isSuccess ? currentSiteUrl.data : null;
  useEffect(() => setSiteUrl(currentUrls?.[site] ?? ""), [currentUrls, site]); // 切换网站时使用当前网址

  // 成功/失败列表
  const successList = useQuery(getSuccessListOptions());
  const failedList = useQuery(getFailedListOptions());
  const saveSuccess = useMutation(saveSuccessListMutation());
  const clearSuccess = useMutation(clearSuccessListMutation());
  const retryFailed = useMutation(retryFailedListMutation());

  // 检查类工具
  const checkMissing = useMutation(checkMissingNumbersMutation());
  const cleanFiles = useMutation(cleanFilesMutation());
  const moveVideos = useMutation(moveVideosMutation());

  // 剧照与主题视频的批量操作
  const manageExtras = useMutation(manageExtrasMutation());
  const manageExtrafanart = useMutation(manageExtrafanartCopyMutation());
  const manageThemeVideos = useMutation(manageThemeVideosMutation());

  // Emby 演员名单与 Kodi 演员文件夹
  const [actorMode, setActorMode] = useState(0);
  const listActors = useMutation(listActorsMutation());
  const manageKodiActors = useMutation(manageKodiActorsMutation());

  const [confirm, setConfirm] = useState<PendingConfirm | null>(null);
  const [showSuccessList, setShowSuccessList] = useState(false);
  const [showFailedList, setShowFailedList] = useState(false);
  const [cutterOpen, setCutterOpen] = useState(false);
  const { cutterPath } = Route.useSearch();

  // 从其它页面带着图片路径跳转过来时, 自动打开封面裁剪器
  useEffect(() => {
    if (cutterPath) setCutterOpen(true);
  }, [cutterPath]);

  const successCount = successList.data?.count ?? 0;
  const failedCount = failedList.data?.count ?? 0;

  const handleStartScrape = async () => {
    showInfo("正在启动刮削任务...");
    try {
      await startScrape.mutateAsync({});
      showSuccess("刮削任务已成功启动，正在跳转到日志页面...");
      setTimeout(() => navigate({ to: "/logs" }), 1000);
    } catch (error) {
      showError(`刮削任务启动失败: ${error}`);
    }
  };

  const handleScrapeSingleFile = async () => {
    if (!singleFilePath) {
      showError("请输入文件路径");
      return;
    }
    showInfo("正在启动单文件刮削任务...");
    try {
      await scrapeSingleFile.mutateAsync({
        body: {
          path: singleFilePath,
          url: singleFileUrl,
        },
      });
      showSuccess("单文件刮削任务已成功启动，正在跳转到日志页面...");
      setTimeout(() => navigate({ to: "/logs" }), 1000);
    } catch (error) {
      showError(`单文件刮削任务启动失败: ${error}`);
    }
  };

  const handleCreateSymlink = async () => {
    if (!sourceDir || !destDir) {
      showError("请输入源目录和目标目录");
      return;
    }
    showInfo("正在启动软链接创建任务...");
    try {
      await createSymlink.mutateAsync({
        body: {
          source_dir: sourceDir,
          dest_dir: destDir,
          copy_files: copyFiles,
        },
      });
      showSuccess("软链接创建任务已成功启动，正在跳转到日志页面...");
      setTimeout(() => navigate({ to: "/logs" }), 1000);
    } catch (error) {
      showError(`软链接创建任务启动失败: ${error}`);
    }
  };

  const handleAddSubtitles = async () => {
    showInfo("正在启动字幕检查和添加任务...");
    try {
      await addSubtitles.mutateAsync({});
      showSuccess("字幕检查和添加任务已成功启动，正在跳转到日志页面...");
      setTimeout(() => navigate({ to: "/logs" }), 1000);
    } catch (error) {
      showError(`字幕添加任务启动失败: ${error}`);
    }
  };

  const handleCompleteActors = async () => {
    showInfo("正在启动演员信息补全任务...");
    try {
      await completeActors.mutateAsync({});
      showSuccess("演员信息补全任务已成功启动，正在跳转到日志页面...");
      setTimeout(() => navigate({ to: "/logs" }), 1000);
    } catch (error) {
      showError(`演员信息补全任务启动失败: ${error}`);
    }
  };

  const handleCheckCookie = async () => {
    showInfo(`正在检测 ${cookieSite} 的 Cookie...`);
    setCookieResult(null);
    try {
      const res = await checkCookie.mutateAsync({ body: { site: cookieSite } });
      setCookieResult({ ok: res.ok, message: res.message });
      res.ok ? showSuccess(res.message) : showError(res.message);
    } catch (error) {
      showError(`Cookie 检测失败: ${error}`);
    }
  };

  const handleSetSiteUrl = async () => {
    try {
      await setSiteUrlMut.mutateAsync({ body: { site, url: siteUrl } });
      await currentSiteUrl.refetch(); // 重新获取服务器设置
      siteUrl ? showSuccess(`成功设置 ${site} 网址: ${siteUrl}`) : showSuccess(`已清除 ${site} 的自定义网址`);
    } catch (error) {
      showError(`设置网站网址失败: ${error}`);
    }
  };

  const handleSaveSuccessList = async () => {
    try {
      const res = await saveSuccess.mutateAsync({});
      showSuccess(res.message ?? "已保存");
      await successList.refetch();
    } catch (error) {
      showError(`保存失败: ${error}`);
    }
  };

  const handleClearSuccessList = () => {
    setConfirm({
      title: "清空成功列表",
      content: "清空后这些文件会被视为未刮削，下次扫描时会重新处理。确定继续吗？",
      confirmText: "清空",
      action: async () => {
        try {
          const res = await clearSuccess.mutateAsync({});
          showSuccess(res.message ?? "已清空");
          await successList.refetch();
        } catch (error) {
          showError(`清空失败: ${error}`);
        }
      },
    });
  };

  const handleRetryFailed = async () => {
    if (failedCount === 0) {
      showError("当前没有失败记录");
      return;
    }
    showInfo("正在用失败列表重新刮削...");
    try {
      const res = await retryFailed.mutateAsync({});
      showSuccess(res.message ?? "已提交");
      setTimeout(() => navigate({ to: "/logs" }), 1000);
    } catch (error) {
      showError(`重新刮削失败: ${error}`);
    }
  };

  const handleCheckMissing = async () => {
    showInfo("正在检查缺失番号...");
    try {
      const res = await checkMissing.mutateAsync({});
      showSuccess(res.message ?? "已开始");
      setTimeout(() => navigate({ to: "/logs" }), 1000);
    } catch (error) {
      showError(`检查失败: ${error}`);
    }
  };

  const handleCleanFiles = () => {
    setConfirm({
      title: "检查并清理文件",
      content: "将扫描媒体目录并删除其中的空目录与残留文件。此操作会真实删除文件，确定继续吗？",
      confirmText: "开始清理",
      action: async () => {
        try {
          const res = await cleanFiles.mutateAsync({});
          showSuccess(res.message ?? "已开始");
          setTimeout(() => navigate({ to: "/logs" }), 1000);
        } catch (error) {
          showError(`${error}`);
        }
      },
    });
  };

  const handleMoveVideos = () => {
    setConfirm({
      title: "移动视频和字幕",
      content: "将把媒体目录下的视频与字幕移动到该目录下的 Movie_moved 子目录，用于避免被再次扫描刮削。确定继续吗？",
      confirmText: "开始移动",
      action: async () => {
        try {
          const res = await moveVideos.mutateAsync({});
          showSuccess(res.message ?? "已开始");
          setTimeout(() => navigate({ to: "/logs" }), 1000);
        } catch (error) {
          showError(`${error}`);
        }
      },
    });
  };

  type ExtrasKind = "extras" | "extrafanart" | "theme";

  const EXTRAS_NAMES: Record<ExtrasKind, string> = {
    extras: "剧照",
    extrafanart: "剧照副本",
    theme: "主题视频",
  };

  const runExtrasAction = async (kind: ExtrasKind, action: "add" | "del") => {
    try {
      let message: string | undefined;
      if (kind === "extras") {
        message = (await manageExtras.mutateAsync({ body: { action } })).message;
      } else if (kind === "extrafanart") {
        message = (await manageExtrafanart.mutateAsync({ body: { action } })).message;
      } else {
        message = (await manageThemeVideos.mutateAsync({ body: { action } })).message;
      }
      showSuccess(message ?? "已开始，结果见日志页");
      setTimeout(() => navigate({ to: "/logs" }), 1000);
    } catch (error) {
      showError(`${error}`);
    }
  };

  const handleExtras = (kind: ExtrasKind, action: "add" | "del") => {
    const label = EXTRAS_NAMES[kind];
    if (action === "add") {
      runExtrasAction(kind, action);
      return;
    }
    setConfirm({
      title: `删除${label}`,
      content: `将删除媒体库中所有影片的${label}。此操作不可撤销，确定继续吗？`,
      confirmText: "删除",
      action: () => runExtrasAction(kind, action),
    });
  };

  const runKodiActors = async (action: "add" | "del") => {
    try {
      const res = await manageKodiActors.mutateAsync({ body: { action } });
      showSuccess(res.message ?? "已开始，结果见日志页");
      setTimeout(() => navigate({ to: "/logs" }), 1000);
    } catch (error) {
      showError(`${error}`);
    }
  };

  const handleKodiActors = (action: "add" | "del") => {
    if (action === "add") {
      runKodiActors(action);
      return;
    }
    setConfirm({
      title: "删除 Kodi 演员文件夹",
      content: "将删除待刮削目录中所有视频的 .actors 文件夹。此操作不可撤销，确定继续吗？",
      confirmText: "删除",
      action: () => runKodiActors(action),
    });
  };

  const handleListActors = async () => {
    showInfo("正在获取演员名单...");
    try {
      const res = await listActors.mutateAsync({ body: { mode: actorMode } });
      showSuccess(res.message ?? "已开始，结果见日志页");
      setTimeout(() => navigate({ to: "/logs" }), 1000);
    } catch (error) {
      showError(`${error}`);
    }
  };

  const handleConfirm = async () => {
    const pending = confirm;
    setConfirm(null);
    await pending?.action();
  };

  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="h4" gutterBottom>
        工具集合
      </Typography>

      <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {/* 刮削工具 */}
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              刮削工具
            </Typography>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <Button
                variant="contained"
                onClick={handleStartScrape}
                disabled={startScrape.isPending}
                sx={{ alignSelf: "flex-start" }}
              >
                {startScrape.isPending ? "正在启动..." : "开始刮削"}
              </Button>

              <Typography variant="subtitle1">单文件刮削</Typography>
              <Box
                sx={{
                  display: "flex",
                  gap: 2,
                  alignItems: "flex-end",
                  flexWrap: "wrap",
                }}
              >
                <TextField
                  label="文件路径"
                  value={singleFilePath}
                  onChange={(e) => setSingleFilePath(e.target.value)}
                  size="small"
                  sx={{ flexGrow: 1, minWidth: 200 }}
                />
                <TextField
                  label="URL（可选）"
                  value={singleFileUrl}
                  onChange={(e) => setSingleFileUrl(e.target.value)}
                  placeholder="留空自动按番号猜站点"
                  size="small"
                  sx={{ flexGrow: 1, minWidth: 200 }}
                />
                <Button
                  variant="outlined"
                  onClick={handleScrapeSingleFile}
                  disabled={scrapeSingleFile.isPending}
                  sx={{ whiteSpace: "nowrap" }}
                >
                  {scrapeSingleFile.isPending ? "正在刮削..." : "单文件刮削"}
                </Button>
              </Box>
            </Box>
          </CardContent>
        </Card>

        {/* 列表管理 */}
        <Box sx={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
          <Card sx={{ flex: "1 1 380px" }}>
            <CardContent>
              <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                <Typography variant="h6">成功列表</Typography>
                <Chip size="small" label={successCount} />
              </Stack>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                已成功刮削的文件，扫描时会跳过它们。
              </Typography>
              <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                <Button
                  size="small"
                  variant="outlined"
                  disabled={successCount === 0}
                  onClick={() => setShowSuccessList(true)}
                >
                  查看
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={handleSaveSuccessList}
                  disabled={saveSuccess.isPending}
                >
                  保存
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  color="error"
                  disabled={successCount === 0}
                  onClick={handleClearSuccessList}
                >
                  清空
                </Button>
              </Box>
            </CardContent>
          </Card>

          <Card sx={{ flex: "1 1 380px" }}>
            <CardContent>
              <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                <Typography variant="h6">失败列表</Typography>
                <Chip size="small" label={failedCount} color={failedCount > 0 ? "error" : "default"} />
              </Stack>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                本次刮削失败的文件，可直接重试。
              </Typography>
              <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                <Button
                  size="small"
                  variant="outlined"
                  disabled={failedCount === 0}
                  onClick={() => setShowFailedList(true)}
                >
                  查看
                </Button>
                <Button
                  size="small"
                  variant="contained"
                  disabled={failedCount === 0 || retryFailed.isPending}
                  onClick={handleRetryFailed}
                >
                  {retryFailed.isPending ? "正在提交..." : "重新刮削"}
                </Button>
              </Box>
            </CardContent>
          </Card>
        </Box>

        {/* 检查工具 */}
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              检查与维护
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              这些操作在后台运行，进度与结果会输出到日志页。
            </Typography>
            <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
              <Button variant="outlined" onClick={handleCheckMissing} disabled={checkMissing.isPending}>
                {checkMissing.isPending ? "正在提交..." : "检查缺失番号"}
              </Button>
              <Button variant="outlined" onClick={handleCleanFiles} disabled={cleanFiles.isPending}>
                检查并清理文件
              </Button>
              <Button variant="outlined" onClick={handleMoveVideos} disabled={moveVideos.isPending}>
                移动视频和字幕
              </Button>
            </Box>
          </CardContent>
        </Card>

        {/* 健康检查 */}
        <HealthCheckCard />

        {/* 刮削残留清理 */}
        <LeftoverCleanCard />

        {/* 影视库去重 */}
        <DuplicatesCard />

        {/* 剧照与主题视频 */}
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              剧照与主题视频
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              为媒体库中所有影片批量处理附加内容。删除操作不可撤销，请谨慎使用。
            </Typography>
            <Stack spacing={2}>
              {(["extras", "extrafanart", "theme"] as const).map((kind) => (
                <Box key={kind} sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                  <Typography variant="subtitle2" sx={{ minWidth: 96 }}>
                    {EXTRAS_NAMES[kind]}
                  </Typography>
                  <Button size="small" variant="outlined" onClick={() => handleExtras(kind, "add")}>
                    添加
                  </Button>
                  <Button size="small" variant="outlined" color="error" onClick={() => handleExtras(kind, "del")}>
                    删除
                  </Button>
                </Box>
              ))}
            </Stack>
          </CardContent>
        </Card>

        {/* 文件管理工具和演员工具 */}
        <Box sx={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
          <Card sx={{ flex: "1 1 400px" }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                文件管理工具
              </Typography>
              <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <Typography variant="subtitle1">创建软链接</Typography>
                <TextField
                  label="源目录"
                  value={sourceDir}
                  onChange={(e) => setSourceDir(e.target.value)}
                  size="small"
                  fullWidth
                />
                <TextField
                  label="目标目录"
                  value={destDir}
                  onChange={(e) => setDestDir(e.target.value)}
                  size="small"
                  fullWidth
                />
                <FormControlLabel
                  control={<Checkbox checked={copyFiles} onChange={(e) => setCopyFiles(e.target.checked)} />}
                  label="复制 nfo, 图片, 字幕等文件"
                />
                <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                  <Button
                    variant="outlined"
                    onClick={handleCreateSymlink}
                    disabled={createSymlink.isPending}
                    size="small"
                  >
                    {createSymlink.isPending ? "正在创建..." : "创建软链接"}
                  </Button>
                  <Button
                    variant="outlined"
                    onClick={handleAddSubtitles}
                    disabled={addSubtitles.isPending}
                    size="small"
                  >
                    {addSubtitles.isPending ? "正在处理..." : "检查并添加字幕"}
                  </Button>
                  <Button variant="outlined" size="small" onClick={() => setCutterOpen(true)}>
                    封面裁剪
                  </Button>
                </Box>
              </Box>
            </CardContent>
          </Card>

          <Card sx={{ flex: "1 1 300px" }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                演员工具
              </Typography>
              <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <Button
                  variant="outlined"
                  onClick={handleCompleteActors}
                  disabled={completeActors.isPending}
                  sx={{ alignSelf: "flex-start" }}
                >
                  {completeActors.isPending ? "正在补全..." : "补全演员信息与头像"}
                </Button>

                <Typography variant="subtitle1">查看演员名单</Typography>
                <Box sx={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap" }}>
                  <FormControl size="small" sx={{ minWidth: 160 }}>
                    <InputLabel>筛选</InputLabel>
                    <Select value={actorMode} label="筛选" onChange={(e) => setActorMode(Number(e.target.value))}>
                      {[
                        "所有演员",
                        "有信息，有头像",
                        "有信息，没头像",
                        "没信息，有头像",
                        "没信息，没头像",
                        "有信息的演员",
                        "没信息的演员",
                        "有头像的演员",
                        "没头像的演员",
                      ].map((label, idx) => (
                        <MenuItem key={label} value={idx}>
                          {label}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  <Button size="small" variant="outlined" onClick={handleListActors} disabled={listActors.isPending}>
                    {listActors.isPending ? "正在获取..." : "获取名单"}
                  </Button>
                </Box>

                <Typography variant="subtitle1">Kodi 演员文件夹</Typography>
                <Typography variant="body2" color="text.secondary">
                  为待刮削目录中每个视频创建或删除 .actors 文件夹。
                </Typography>
                <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                  <Button size="small" variant="outlined" onClick={() => handleKodiActors("add")}>
                    创建
                  </Button>
                  <Button size="small" variant="outlined" color="error" onClick={() => handleKodiActors("del")}>
                    删除
                  </Button>
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Box>

        {/* 网站设置工具 */}
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              网站设置工具
            </Typography>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <Typography variant="subtitle1">Cookie 有效性检查</Typography>
              <Typography variant="body2" color="text.secondary">
                检测配置中保存的 Cookie 是否仍可用。Cookie 本身在「设置」页填写。
              </Typography>
              <Box sx={{ display: "flex", gap: 2, alignItems: "center", flexWrap: "wrap" }}>
                <FormControl size="small" sx={{ minWidth: 120 }}>
                  <InputLabel>站点</InputLabel>
                  <Select
                    value={cookieSite}
                    label="站点"
                    onChange={(e) => {
                      setCookieSite(e.target.value as "javbus" | "javdb");
                      setCookieResult(null);
                    }}
                  >
                    <MenuItem value="javbus">JavBus</MenuItem>
                    <MenuItem value="javdb">JavDB</MenuItem>
                  </Select>
                </FormControl>
                <Button variant="outlined" onClick={handleCheckCookie} disabled={checkCookie.isPending}>
                  {checkCookie.isPending ? "正在检测..." : "开始检测"}
                </Button>
                {cookieResult ? (
                  <Chip
                    size="small"
                    color={cookieResult.ok ? "success" : "error"}
                    label={cookieResult.message}
                    sx={{ maxWidth: 420 }}
                  />
                ) : null}
              </Box>

              <Divider sx={{ my: 1 }} />

              <Typography variant="subtitle1">设置网站自定义网址</Typography>
              <Box
                sx={{
                  display: "flex",
                  gap: 2,
                  alignItems: "flex-end",
                  flexWrap: "wrap",
                }}
              >
                <FormControl size="small" sx={{ minWidth: 120 }}>
                  <InputLabel>网站</InputLabel>
                  <Select value={site} label="网站" onChange={(e) => setSite(e.target.value)}>
                    {WebsiteSchema.enum.map((w) => (
                      <MenuItem key={w} value={w}>
                        {w}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <TextField
                  label="自定义URL"
                  value={siteUrl}
                  onChange={(e) => setSiteUrl(e.target.value)}
                  size="small"
                  sx={{ flexGrow: 1, minWidth: 200 }}
                />
                <Button
                  variant="outlined"
                  onClick={handleSetSiteUrl}
                  disabled={setSiteUrlMut.isPending}
                  sx={{ whiteSpace: "nowrap" }}
                >
                  {setSiteUrlMut.isPending ? "正在设置..." : "设置网站网址"}
                </Button>
              </Box>
            </Box>
          </CardContent>
        </Card>
      </Box>

      {/* 封面裁剪 */}
      <PosterCutter open={cutterOpen} onClose={() => setCutterOpen(false)} initialPath={cutterPath} />

      {/* 破坏性操作确认 */}
      <Dialog open={confirm !== null} onClose={() => setConfirm(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{confirm?.title}</DialogTitle>
        <DialogContent>
          <DialogContentText>{confirm?.content}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirm(null)}>取消</Button>
          <Button variant="contained" color="error" onClick={handleConfirm}>
            {confirm?.confirmText}
          </Button>
        </DialogActions>
      </Dialog>

      {/* 成功列表 */}
      <Dialog open={showSuccessList} onClose={() => setShowSuccessList(false)} maxWidth="md" fullWidth>
        <DialogTitle>成功列表 ({successCount})</DialogTitle>
        <DialogContent dividers>
          <List dense>
            {(successList.data?.paths ?? []).map((p) => (
              <ListItem key={p} disableGutters>
                <ListItemText primary={p} slotProps={{ primary: { sx: { wordBreak: "break-all", fontSize: 13 } } }} />
              </ListItem>
            ))}
          </List>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowSuccessList(false)}>关闭</Button>
        </DialogActions>
      </Dialog>

      {/* 失败列表 */}
      <Dialog open={showFailedList} onClose={() => setShowFailedList(false)} maxWidth="md" fullWidth>
        <DialogTitle>失败列表 ({failedCount})</DialogTitle>
        <DialogContent dividers>
          <List dense>
            {(failedList.data?.items ?? []).map((item) => (
              <ListItem key={item.path} disableGutters>
                <ListItemText
                  primary={item.path}
                  secondary={item.reason}
                  slotProps={{
                    primary: { sx: { wordBreak: "break-all", fontSize: 13 } },
                    secondary: { sx: { color: "error.main", fontSize: 12 } },
                  }}
                />
              </ListItem>
            ))}
          </List>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowFailedList(false)}>关闭</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

const MISSING_LABELS: Record<string, string> = {
  nfo: "未刮削 (没有 NFO)",
  nfo_invalid: "NFO 无法解析",
  poster: "缺封面",
  fanart: "缺剧照",
  title: "缺标题",
  releasedate: "缺发行日期",
  actor: "缺演员",
};

/** 媒体库健康检查: 扫描出未刮削/缺封面/字段缺失的影片, 便于逐个修复. */
function HealthCheckCard() {
  const { showSuccess, showError } = useToast();
  const [report, setReport] = useState<HealthReport | null>(null);
  const healthQ = useQuery({ ...getHealthReportOptions(), enabled: false, queryKey: ["healthReport"] });

  const runScan = async () => {
    try {
      const res = await healthQ.refetch();
      if (res.data) {
        setReport(res.data);
        showSuccess(`扫描完成: ${res.data.scanned} 部影片, ${res.data.issues.length} 个问题`);
      }
    } catch (err) {
      showError(`扫描失败: ${err}`);
    }
  };

  const groups = Object.entries(
    (report?.issues ?? []).reduce<Record<string, string[]>>((acc, issue) => {
      const key = issue.missing[0] ?? "other";
      const list = acc[key] ?? [];
      list.push(issue.path);
      acc[key] = list;
      return acc;
    }, {}),
  ).sort((a, b) => b[1].length - a[1].length);

  return (
    <Card>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          健康检查
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          扫描媒体库, 找出未刮削、缺封面、NFO 字段缺失的影片。发现封面问题后可到「封面裁剪」修复。
        </Typography>
        <Box sx={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap", mb: 1 }}>
          <Button variant="outlined" onClick={runScan} disabled={healthQ.isFetching}>
            {healthQ.isFetching ? "扫描中..." : "开始扫描"}
          </Button>
          {report && (
            <Chip
              size="small"
              color={report.issues.length ? "warning" : "success"}
              label={`共 ${report.scanned} 部 · 正常 ${report.ok} · 问题 ${report.issues.length}`}
            />
          )}
        </Box>
        {groups.map(([kind, paths]) => (
          <Box key={kind} sx={{ mb: 1.5 }}>
            <Typography variant="subtitle2">
              {MISSING_LABELS[kind] ?? kind} ({paths.length})
            </Typography>
            <List dense disablePadding sx={{ maxHeight: 200, overflow: "auto" }}>
              {paths.map((path) => (
                <ListItem key={path} disableGutters>
                  <ListItemText
                    primary={path}
                    slotProps={{ primary: { sx: { wordBreak: "break-all", fontSize: 13 } } }}
                  />
                </ListItem>
              ))}
            </List>
          </Box>
        ))}
      </CardContent>
    </Card>
  );
}

/** 把字节数格式化成可读大小. */
function formatSize(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

/** 刮削残留清理: 扫描刮削目录里刮完后剩下的杂项(图片/广告/nfo/空目录), 用户确认后删除. */
function LeftoverCleanCard() {
  const { showSuccess, showError } = useToast();
  const [report, setReport] = useState<LeftoversResponse | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const leftoversQ = useQuery({ ...getScrapeLeftoversOptions(), enabled: false, queryKey: ["scrapeLeftovers"] });

  const runScan = async () => {
    try {
      const res = await leftoversQ.refetch();
      if (res.data) {
        setReport(res.data);
        // 默认全选非视频残留(含空目录); 剩余视频=未刮成的影片, 只展示不勾选
        setSelected(new Set(res.data.leftovers.map((i) => i.path)));
        showSuccess(`扫描完成: 残留 ${res.data.leftovers.length} 项, 未刮成视频 ${res.data.videos.length} 个`);
      }
    } catch (err) {
      showError(`扫描失败: ${err}`);
    }
  };

  const toggle = (path: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const handleDelete = async () => {
    setConfirmOpen(false);
    setDeleting(true);
    try {
      const res = await cleanScrapeLeftovers({ body: { paths: [...selected] } });
      showSuccess(res.data?.message ?? "清理完成");
      await runScan();
    } catch (err) {
      showError(`清理失败: ${err}`);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Card>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          刮削残留清理
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          扫媒体路径(刮削源)里刮削后剩下的杂项: 下载附带的图片、广告、NFO、空目录等。 默认全选, 可逐项取消;
          列出的视频文件是没刮成的影片, 不会参与删除。
        </Typography>
        <Box sx={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap", mb: 1 }}>
          <Button variant="outlined" onClick={runScan} disabled={leftoversQ.isFetching}>
            {leftoversQ.isFetching ? "扫描中..." : "扫描残留"}
          </Button>
          {report && (
            <Chip
              size="small"
              color={report.leftovers.length ? "warning" : "success"}
              label={`残留 ${report.leftovers.length} 项 · ${formatSize(report.total_size)} · 未刮成视频 ${report.videos.length}`}
            />
          )}
          <Button
            variant="contained"
            color="error"
            disabled={deleting || selected.size === 0}
            onClick={() => setConfirmOpen(true)}
          >
            {deleting ? "删除中..." : `删除选中 (${selected.size})`}
          </Button>
        </Box>
        {report && report.videos.length > 0 && (
          <Box sx={{ mb: 1 }}>
            <Typography variant="subtitle2" color="text.secondary">
              未刮成的视频(不参与删除)
            </Typography>
            <List dense disablePadding sx={{ maxHeight: 140, overflow: "auto" }}>
              {report.videos.map((v) => (
                <ListItem key={v.path} disableGutters>
                  <ListItemText
                    primary={v.path}
                    secondary={formatSize(v.size)}
                    slotProps={{
                      primary: { sx: { wordBreak: "break-all", fontSize: 13 } },
                      secondary: { sx: { fontSize: 12 } },
                    }}
                  />
                </ListItem>
              ))}
            </List>
          </Box>
        )}
        {report && report.leftovers.length > 0 && (
          <List dense disablePadding sx={{ maxHeight: 300, overflow: "auto" }}>
            {report.leftovers.map((item) => (
              <ListItem key={item.path} disableGutters dense>
                <Checkbox size="small" checked={selected.has(item.path)} onChange={() => toggle(item.path)} />
                <ListItemText
                  primary={item.path}
                  secondary={item.is_dir ? "空目录" : formatSize(item.size)}
                  slotProps={{
                    primary: { sx: { wordBreak: "break-all", fontSize: 13 } },
                    secondary: { sx: { fontSize: 12 } },
                  }}
                />
              </ListItem>
            ))}
          </List>
        )}
        <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} maxWidth="xs" fullWidth>
          <DialogTitle>确认删除残留</DialogTitle>
          <DialogContent>
            <DialogContentText>
              将从刮削目录删除选中的 {selected.size} 项, 该操作不可恢复。确定继续吗?
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setConfirmOpen(false)}>取消</Button>
            <Button variant="contained" color="error" onClick={handleDelete}>
              删除
            </Button>
          </DialogActions>
        </Dialog>
      </CardContent>
    </Card>
  );
}

/** 影视库去重: 按番号(NFO 优先, 文件名解析兜底)对比所有影视库, 找出重复副本供用户选择删除. */
function DuplicatesCard() {
  const { showSuccess, showError } = useToast();
  const [report, setReport] = useState<DuplicatesResponse | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const dupQ = useQuery({ ...scanDuplicatesOptions(), enabled: false, queryKey: ["duplicates"] });

  const runScan = async () => {
    try {
      const res = await dupQ.refetch();
      if (res.data) {
        setReport(res.data);
        setSelected(new Set());
        showSuccess(`扫描完成: ${res.data.scanned} 部影片, ${res.data.groups.length} 组重复`);
      }
    } catch (err) {
      showError(`扫描失败: ${err}`);
    }
  };

  const toggle = (path: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const handleDelete = async () => {
    setConfirmOpen(false);
    setDeleting(true);
    try {
      const res = await deleteDuplicates({ body: { paths: [...selected] } });
      showSuccess(res.data?.message ?? "删除完成");
      setSelected(new Set());
      await runScan();
    } catch (err) {
      showError(`删除失败: ${err}`);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Card>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          影视库去重
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          按番号对比「设置 → 影视库去重 → 影视库目录」里配置的所有库(可多个), 找出同一部影片的重复副本。 番号取自 NFO
          或文件名解析, 文件名不同的重复也能对上。扫描范围只含影视库, 与刮削源互不影响。
        </Typography>
        <Box sx={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap", mb: 1 }}>
          <Button variant="outlined" onClick={runScan} disabled={dupQ.isFetching}>
            {dupQ.isFetching ? "扫描中..." : "开始去重扫描"}
          </Button>
          {report && (
            <Chip
              size="small"
              color={report.groups.length ? "warning" : "success"}
              label={`扫描 ${report.scanned} 部 · 重复 ${report.groups.length} 组`}
            />
          )}
          <Button
            variant="contained"
            color="error"
            disabled={deleting || selected.size === 0}
            onClick={() => setConfirmOpen(true)}
          >
            {deleting ? "删除中..." : `删除选中副本 (${selected.size})`}
          </Button>
        </Box>
        {(report?.groups ?? []).map((group) => (
          <Box key={group.number} sx={{ mb: 1.5 }}>
            <Typography variant="subtitle2">
              {group.number} ({group.items.length} 个副本, 共 {formatSize(group.items.reduce((s, i) => s + i.size, 0))})
            </Typography>
            <List dense disablePadding sx={{ maxHeight: 200, overflow: "auto" }}>
              {group.items.map((item) => (
                <ListItem key={item.path} disableGutters dense>
                  <Checkbox size="small" checked={selected.has(item.path)} onChange={() => toggle(item.path)} />
                  <ListItemText
                    primary={item.path}
                    secondary={[formatSize(item.size), item.from_nfo ? "番号来自NFO" : "番号来自文件名"].join(" · ")}
                    slotProps={{
                      primary: { sx: { wordBreak: "break-all", fontSize: 13 } },
                      secondary: { sx: { fontSize: 12 } },
                    }}
                  />
                </ListItem>
              ))}
            </List>
          </Box>
        ))}
        <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} maxWidth="xs" fullWidth>
          <DialogTitle>确认删除副本</DialogTitle>
          <DialogContent>
            <DialogContentText>将删除选中的 {selected.size} 个影片副本, 该操作不可恢复。确定继续吗?</DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setConfirmOpen(false)}>取消</Button>
            <Button variant="contained" color="error" onClick={handleDelete}>
              删除
            </Button>
          </DialogActions>
        </Dialog>
      </CardContent>
    </Card>
  );
}
