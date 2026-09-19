import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControl,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import type { IChangeEvent } from "@rjsf/core";
import { Form } from "@rjsf/mui";
import type { RJSFSchema } from "@rjsf/utils";
import validator from "@rjsf/validator-ajv8";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  createConfigMutation,
  deleteConfigMutation,
  getConfigSchemaOptions,
  getConfigUiSchemaOptions,
  getCurrentConfigOptions,
  listConfigsOptions,
  resetConfigMutation,
  switchConfigMutation,
  updateConfigMutation,
} from "@/client/@tanstack/react-query.gen";
import type { ConfigInput } from "@/client/types.gen";
import { fields } from "@/components/form";
import { useToast } from "@/contexts/ToastProvider";

export const Route = createFileRoute("/settings")({
  component: SettingsComponent,
});

/** 按键名排序后序列化, 避免同一份数据因字段顺序不同被判定为有改动. */
function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
}

/** 配置文件管理: 新建/切换/删除/重置. 切换或重置后需要重置表单草稿, 否则显示的还是旧配置. */
function ConfigManagerBar({ onConfigReplaced }: { onConfigReplaced: (next: ConfigInput) => void }) {
  const listQ = useQuery(listConfigsOptions());
  const queryClient = useQueryClient();
  const { showSuccess, showError } = useToast();

  const [selected, setSelected] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [confirm, setConfirm] = useState<null | "switch" | "delete" | "reset">(null);

  const current = listQ.data?.current ?? "";
  // 选中值默认跟随当前配置; 用 key 无效就比字符串
  useEffect(() => {
    setSelected((prev) => (prev && listQ.data?.configs.includes(prev) ? prev : current));
  }, [listQ.data, current]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: listConfigsOptions().queryKey });
  };

  const switchMut = useMutation(switchConfigMutation());
  const createMut = useMutation(createConfigMutation());
  const deleteMut = useMutation(deleteConfigMutation());
  const resetMut = useMutation(resetConfigMutation());

  const busy = switchMut.isPending || createMut.isPending || deleteMut.isPending || resetMut.isPending;

  const handleSwitch = async () => {
    setConfirm(null);
    try {
      const res = await switchMut.mutateAsync({ path: {}, query: { name: selected } });
      if (res.data) {
        onConfigReplaced(res.data.config as ConfigInput);
        if (res.data.errors.length) showError(res.data.errors.join("\n"));
      }
      invalidate();
      showSuccess(`已切换到配置 ${selected}`);
    } catch (error) {
      showError(`切换失败: ${error}`);
    }
  };

  const handleCreate = async () => {
    const name = newName.trim();
    setCreateOpen(false);
    setNewName("");
    try {
      await createMut.mutateAsync({ path: {}, query: { name } });
      invalidate();
      showSuccess(`已创建配置 ${name}, 可在左侧下拉切换`);
    } catch (error) {
      showError(`创建失败: ${error}`);
    }
  };

  const handleDelete = async () => {
    setConfirm(null);
    try {
      await deleteMut.mutateAsync({ path: {}, query: { name: selected } });
      invalidate();
      showSuccess(`已删除配置 ${selected}`);
    } catch (error) {
      showError(`删除失败: ${error}`);
    }
  };

  const handleReset = async () => {
    setConfirm(null);
    try {
      const res = await resetMut.mutateAsync({ path: {} });
      if (res.data) onConfigReplaced(res.data as ConfigInput);
      invalidate();
      showSuccess("已重置为默认配置");
    } catch (error) {
      showError(`重置失败: ${error}`);
    }
  };

  const configAction = (action: "switch" | "delete" | "reset", title: string, text: string) => (
    <Dialog open={confirm === action} onClose={() => setConfirm(null)} maxWidth="xs" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <DialogContentText>{text}</DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setConfirm(null)}>取消</Button>
        <Button
          variant="contained"
          color={action === "delete" ? "error" : "primary"}
          onClick={action === "switch" ? handleSwitch : action === "delete" ? handleDelete : handleReset}
        >
          确定
        </Button>
      </DialogActions>
    </Dialog>
  );

  return (
    <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
      <Typography variant="h4">设置</Typography>
      {current && <Chip size="small" label={`当前: ${current}`} variant="outlined" />}
      <Box flexGrow={1} />
      <TextField
        select
        size="small"
        label="配置文件"
        sx={{ minWidth: 160 }}
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        disabled={busy}
      >
        {(listQ.data?.configs ?? []).map((name) => (
          <MenuItem key={name} value={name}>
            {name}
            {name === current ? "（当前）" : ""}
          </MenuItem>
        ))}
      </TextField>
      <Button
        size="small"
        variant="outlined"
        disabled={busy || !selected || selected === current}
        onClick={() => setConfirm("switch")}
      >
        切换
      </Button>
      <Button size="small" variant="outlined" disabled={busy} onClick={() => setCreateOpen(true)}>
        新建
      </Button>
      <Button
        size="small"
        variant="outlined"
        color="error"
        disabled={busy || !selected || selected === current}
        onClick={() => setConfirm("delete")}
      >
        删除
      </Button>
      <Button size="small" variant="outlined" color="warning" disabled={busy} onClick={() => setConfirm("reset")}>
        重置为默认
      </Button>

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>新建配置文件</DialogTitle>
        <DialogContent>
          <DialogContentText>以默认配置创建一份新的配置文件, 之后可切换使用。</DialogContentText>
          <TextField
            autoFocus
            fullWidth
            size="small"
            margin="dense"
            label="配置名"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newName.trim()) handleCreate();
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)}>取消</Button>
          <Button variant="contained" disabled={!newName.trim()} onClick={handleCreate}>
            创建
          </Button>
        </DialogActions>
      </Dialog>

      {configAction("switch", "切换配置", `切换到 ${selected} 后, 当前未保存的修改会丢失。`)}
      {configAction("delete", "删除配置", `确定删除配置文件 ${selected}.json 吗？此操作不可恢复。`)}
      {configAction("reset", "重置配置", "将把当前配置恢复为默认值, 所有修改都会丢失。")}
    </Stack>
  );
}

function SettingsComponent() {
  const configQ = useQuery(getCurrentConfigOptions());
  const schemaQ = useQuery(getConfigSchemaOptions());
  const uiSchemaQ = useQuery(getConfigUiSchemaOptions());
  const { showSuccess, showError } = useToast();

  const saveConfig = useMutation(updateConfigMutation());

  // rjsf 是受控表单, 需要一个本地草稿; 只在首次拿到服务端配置时填充,
  // 这样后台重新拉取不会冲掉正在编辑的内容.
  const [draft, setDraft] = useState<ConfigInput | null>(null);
  // 判断"是否有改动"不能依赖 onChange 是否触发过: rjsf 初始化时会自行触发一次,
  // 所以改为把当前草稿与上一次落盘的内容做比较.
  const [baseline, setBaseline] = useState<string | null>(null);

  useEffect(() => {
    if (configQ.data && draft === null) {
      setDraft(configQ.data);
      setBaseline(stableStringify(configQ.data));
    }
  }, [configQ.data, draft]);

  const dirty = draft !== null && baseline !== null && stableStringify(draft) !== baseline;

  // 配置项多达百余条, 用户改完后可能直接刷新或关闭页面, 这里拦一下避免白改
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const handleSubmit = async ({ formData }: IChangeEvent<ConfigInput>) => {
    if (!formData) return;
    try {
      await saveConfig.mutateAsync({ body: formData });
      // 基线取刚提交的内容, 而不是服务端返回值: 表单里持有的值就是这份数据,
      // 换成返回值会让两者再次出现差异, 保存后仍显示"有未保存的修改".
      setBaseline(stableStringify(formData));
      showSuccess("配置已保存");
      void configQ.refetch(); // 不参与判定, 仅让缓存与后端保持一致
    } catch (error) {
      showError(`保存失败: ${error}`);
    }
  };

  return (
    schemaQ.isSuccess &&
    uiSchemaQ.isSuccess &&
    draft && (
      <div className="p-2">
        <ConfigManagerBar
          onConfigReplaced={(next) => {
            // 切换/重置后, 草稿和基线都换成新配置, 避免旧草稿被误保存到新配置
            setDraft(next);
            setBaseline(stableStringify(next));
          }}
        />
        <FormControl fullWidth sx={{ mb: 2 }}>
          <Form
            schema={schemaQ.data as RJSFSchema}
            uiSchema={uiSchemaQ.data}
            validator={validator}
            formData={draft}
            fields={fields}
            onChange={({ formData: next }: IChangeEvent<ConfigInput>) => {
              if (next) setDraft(next);
            }}
            onSubmit={handleSubmit}
            onError={() => showError("表单校验未通过, 请检查标红的字段")}
          >
            {/* 表单有上百个字段, 默认的提交按钮被顶到最底部, 用户改完根本找不到;
                这里换成固定在右下角的悬浮栏, 让保存随时可点 */}
            <Stack
              direction="row"
              spacing={2}
              sx={{
                position: "fixed",
                right: 24,
                bottom: 24,
                zIndex: (theme) => theme.zIndex.snackbar,
                alignItems: "center",
                bgcolor: "background.paper",
                border: 1,
                borderColor: "divider",
                borderRadius: 2,
                boxShadow: 4,
                px: 2,
                py: 1,
              }}
            >
              {dirty && (
                <Typography variant="body2" color="warning.main">
                  有未保存的修改
                </Typography>
              )}
              <Button type="submit" variant="contained" disabled={saveConfig.isPending || !dirty}>
                {saveConfig.isPending ? "保存中..." : "保存"}
              </Button>
            </Stack>
          </Form>
        </FormControl>
      </div>
    )
  );
}
