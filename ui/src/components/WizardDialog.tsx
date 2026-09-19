import FolderOpen from "@mui/icons-material/FolderOpen";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  LinearProgress,
  Paper,
  Radio,
  RadioGroup,
  Stack,
  Step,
  StepLabel,
  Stepper,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { getCurrentConfigOptions, updateConfigMutation } from "@/client/@tanstack/react-query.gen";
import type { ConfigInput } from "@/client/types.gen";
import { useToast } from "@/contexts/ToastProvider";
import { FileBrowser } from "./FileBrowser";

const STEPS = ["媒体库", "整理方式", "网络"];

/**
 * 首次使用引导向导.
 *
 * 由首页在 config.wizard_done 为 false 时弹出, 只问三件必须由用户决定的事:
 * 媒体库在哪、影片往哪整理、要不要走代理. 其余配置全部使用默认值,
 * 完成或跳过后写入 wizard_done, 不再弹出.
 */
export function WizardDialog({ open, config, onClose }: { open: boolean; config: ConfigInput; onClose: () => void }) {
  const { showSuccess, showError } = useToast();
  const queryClient = useQueryClient();

  const [step, setStep] = useState(0);
  const [mediaPath, setMediaPath] = useState(config.media_path || "");
  // 只有用户改过输出目录时才保留原值, 否则跟随新选的媒体库路径
  const [outputTouched, setOutputTouched] = useState(false);
  const [outputMode, setOutputMode] = useState<"move" | "stay">("move");
  const [successOutputFolder, setSuccessOutputFolder] = useState(config.success_output_folder || "JAV_output");
  const [useProxy, setUseProxy] = useState(config.use_proxy ?? false);
  const [proxy, setProxy] = useState(config.proxy || "http://127.0.0.1:7890");

  const [browserOpen, setBrowserOpen] = useState(false);
  const [browserTarget, setBrowserTarget] = useState<"media" | "output">("media");

  const saveMut = useMutation(updateConfigMutation());

  const resolvedOutput =
    !outputTouched && successOutputFolder === (config.success_output_folder || "JAV_output") && mediaPath
      ? `${mediaPath.replace(/\/$/, "")}/JAV_output`
      : successOutputFolder;

  const markConfigDone = async (body: ConfigInput) => {
    await saveMut.mutateAsync({ body });
    void queryClient.invalidateQueries({ queryKey: getCurrentConfigOptions().queryKey });
  };

  const finish = async () => {
    const body: ConfigInput = {
      ...config,
      media_path: mediaPath,
      success_output_folder: outputMode === "move" ? resolvedOutput : config.success_output_folder,
      success_file_move: outputMode === "move",
      failed_output_folder:
        config.failed_output_folder === "failed" && mediaPath
          ? `${mediaPath.replace(/\/$/, "")}/failed`
          : config.failed_output_folder,
      use_proxy: useProxy,
      proxy: useProxy ? proxy : config.proxy,
      wizard_done: true,
    };
    try {
      await markConfigDone(body);
      showSuccess("初始设置完成, 可以开始刮削了");
      onClose();
    } catch (error) {
      showError(`保存失败: ${error}`);
    }
  };

  const skip = async () => {
    try {
      await markConfigDone({ ...config, wizard_done: true });
      onClose();
    } catch (error) {
      showError(`保存失败: ${error}`);
    }
  };

  const openBrowser = (target: "media" | "output") => {
    setBrowserTarget(target);
    setBrowserOpen(true);
  };

  return (
    <Dialog open={open} maxWidth="sm" fullWidth disableEscapeKeyDown>
      <DialogTitle>欢迎使用 MDCx</DialogTitle>
      <DialogContent>
        <Stepper activeStep={step} sx={{ mt: 1 }}>
          {STEPS.map((label) => (
            <Step key={label}>
              <StepLabel>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>
        {step === 0 && (
          <Stack spacing={2} sx={{ mt: 2 }}>
            <Typography variant="body2" color="text.secondary">
              只需要三步就能开始刮削: 告诉我影片放在哪、刮削后怎么整理、要不要走代理。其他选项保持默认即可,
              之后可随时在「设置」里调整。
            </Typography>
            <Typography variant="subtitle2">影片放在哪个目录？</Typography>
            <TextField
              size="small"
              value={mediaPath}
              placeholder="/media"
              onChange={(e) => setMediaPath(e.target.value)}
              slotProps={{
                input: {
                  endAdornment: (
                    <Button startIcon={<FolderOpen />} onClick={() => openBrowser("media")}>
                      选择目录
                    </Button>
                  ),
                },
              }}
            />
            <Typography variant="caption" color="text.secondary">
              Docker 部署时这里应填容器内的挂载路径, 例如 compose 中把 NAS 的 影视 目录挂到了 /media
            </Typography>
          </Stack>
        )}
        {step === 1 && (
          <Stack spacing={2} sx={{ mt: 2 }}>
            <Typography variant="subtitle2">刮削完成后影片文件怎么处理？</Typography>
            <RadioGroup value={outputMode} onChange={(e) => setOutputMode(e.target.value as "move" | "stay")}>
              <Paper variant="outlined" sx={{ px: 2, py: 1, mb: 1 }}>
                <FormControlLabel
                  value="move"
                  control={<Radio />}
                  label={
                    <Box>
                      <Typography variant="body2">整理到独立目录（推荐）</Typography>
                      <Typography variant="caption" color="text.secondary">
                        按演员/番号建目录归类并重命名, 媒体库整齐好管理
                      </Typography>
                    </Box>
                  }
                />
                {outputMode === "move" && (
                  <TextField
                    size="small"
                    fullWidth
                    sx={{ mt: 1 }}
                    value={resolvedOutput}
                    onChange={(e) => {
                      setSuccessOutputFolder(e.target.value);
                      setOutputTouched(true);
                    }}
                    slotProps={{
                      input: {
                        endAdornment: (
                          <Button startIcon={<FolderOpen />} onClick={() => openBrowser("output")}>
                            选择目录
                          </Button>
                        ),
                      },
                    }}
                  />
                )}
              </Paper>
              <Paper variant="outlined" sx={{ px: 2, py: 1 }}>
                <FormControlLabel
                  value="stay"
                  control={<Radio />}
                  label={
                    <Box>
                      <Typography variant="body2">留在原目录</Typography>
                      <Typography variant="caption" color="text.secondary">
                        不移动文件, 只在旁边生成封面图和 NFO 元数据
                      </Typography>
                    </Box>
                  }
                />
              </Paper>
            </RadioGroup>
          </Stack>
        )}
        {step === 2 && (
          <Stack spacing={2} sx={{ mt: 2 }}>
            <Typography variant="subtitle2">需要代理才能访问刮削源吗？</Typography>
            <FormControlLabel
              control={<Switch checked={useProxy} onChange={(e) => setUseProxy(e.target.checked)} />}
              label={useProxy ? "使用代理" : "不使用代理"}
            />
            {useProxy && (
              <TextField
                size="small"
                label="代理地址"
                value={proxy}
                onChange={(e) => setProxy(e.target.value)}
                placeholder="http://mdcx-clash:7890"
              />
            )}
            <Typography variant="caption" color="text.secondary">
              本项目 Docker 部署时已内置 clash 容器, 代理地址填 http://mdcx-clash:7890 即可; 网络正常也可以之后再开
            </Typography>
          </Stack>
        )}
        {saveMut.isPending && <LinearProgress sx={{ mt: 2 }} />}
      </DialogContent>
      <DialogActions>
        <Button onClick={skip} disabled={saveMut.isPending}>
          跳过, 直接进入
        </Button>
        {step > 0 && (
          <Button onClick={() => setStep(step - 1)} disabled={saveMut.isPending}>
            上一步
          </Button>
        )}
        {step < STEPS.length - 1 ? (
          <Button variant="contained" onClick={() => setStep(step + 1)} disabled={step === 0 && !mediaPath.trim()}>
            下一步
          </Button>
        ) : (
          <Button variant="contained" onClick={finish} disabled={saveMut.isPending}>
            完成
          </Button>
        )}
      </DialogActions>
      <Dialog open={browserOpen} onClose={() => setBrowserOpen(false)} maxWidth="md" fullWidth>
        <DialogContent>
          <Box sx={{ pt: 1 }}>
            <FileBrowser
              initialPath={mediaPath || "."}
              onSelect={
                browserTarget === "media"
                  ? (paths) => {
                      setMediaPath(paths[0] ?? "");
                      setBrowserOpen(false);
                    }
                  : (paths) => {
                      if (paths[0]) {
                        setSuccessOutputFolder(paths[0]);
                        setOutputTouched(true);
                      }
                      setBrowserOpen(false);
                    }
              }
              selectionType="directory"
            />
          </Box>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
