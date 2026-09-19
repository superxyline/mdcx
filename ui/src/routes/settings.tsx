import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  FormControl,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import type { IChangeEvent } from "@rjsf/core";
import { Form } from "@rjsf/mui";
import type { RJSFSchema, UiSchema } from "@rjsf/utils";
import validator from "@rjsf/validator-ajv8";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
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

/** 设置分区的定义: 左侧导航按此渲染, 每个分区只显示自己的字段. */
type SectionDef = {
  key: string;
  label: string;
  group: "常用设置" | "高级选项";
  desc: string;
  fields: string[];
};

/** 不在任何分区显示的字段(由程序内部维护). */
const HIDDEN_FIELDS = ["wizard_done"];

const SECTIONS: SectionDef[] = [
  {
    key: "start",
    label: "快速上手",
    group: "常用设置",
    desc: "刚装好只需要关心这里: 媒体库在哪、往哪整理、要下载什么",
    fields: [
      "media_path",
      "success_output_folder",
      "failed_output_folder",
      "media_type",
      "download_files",
      "success_file_move",
      "failed_file_move",
      "auto_link",
      "thread_number",
      "scrape_like",
    ],
  },
  {
    key: "server",
    label: "媒体服务器",
    group: "常用设置",
    desc: "对接 Emby / Jellyfin: 刮削完自动刷新媒体库、补全演员信息",
    fields: [
      "server_type",
      "emby_url",
      "api_key",
      "user_id",
      "emby_refresh",
      "emby_on",
      "use_database",
      "info_database_path",
      "gfriends_github",
      "actor_photo_folder",
      "actor_photo_kodi_auto",
    ],
  },
  {
    key: "network",
    label: "代理与网络",
    group: "常用设置",
    desc: "刮削源无法直连时配置代理, 以及请求超时/重试",
    fields: ["use_proxy", "proxy", "timeout", "retry", "theporndb_api_token", "javdb", "javbus"],
  },
  {
    key: "notify",
    label: "完成通知",
    group: "常用设置",
    desc: "每轮刮削结束后把成功/失败统计推送到手机 (Bark 或 Telegram)",
    fields: ["notify_type", "bark_url", "bark_key", "telegram_bot_token", "telegram_chat_id"],
  },
  {
    key: "website",
    label: "网站源",
    group: "高级选项",
    desc: "各类型影片使用哪些网站、按什么顺序抓取, 以及标题来源偏好",
    fields: [
      "website_single",
      "website_youma",
      "website_wuma",
      "website_suren",
      "website_oumei",
      "website_guochan",
      "site_configs",
      "title_sehua",
      "title_yesjav",
      "title_sehua_zh",
      "actor_realname",
      "outline_format",
    ],
  },
  {
    key: "nfo",
    label: "字段与 NFO",
    group: "高级选项",
    desc: "元数据字段的内容来源与 NFO 文件里写入哪些标签",
    fields: [
      "field_configs",
      "translate_config",
      "nfo_include_new",
      "nfo_tagline",
      "nfo_tag_include",
      "nfo_tag_series",
      "nfo_tag_studio",
      "nfo_tag_publisher",
      "nfo_tag_actor",
      "nfo_tag_actor_contains",
    ],
  },
  {
    key: "naming",
    label: "命名规则",
    group: "高级选项",
    desc: "刮削后目录/文件的命名模板、中文字幕等后缀的识别与标记",
    fields: [
      "folder_name",
      "naming_file",
      "naming_media",
      "prevent_char",
      "fields_rule",
      "suffix_sort",
      "actor_no_name",
      "release_rule",
      "folder_name_max",
      "file_name_max",
      "actor_name_max",
      "actor_name_more",
      "umr_style",
      "leak_style",
      "wuma_style",
      "youma_style",
      "cd_name",
      "cd_char",
      "pic_simple_name",
      "trailer_simple_name",
      "hd_name",
      "hd_get",
      "cnword_char",
      "cnword_style",
      "folder_cnword",
      "file_cnword",
    ],
  },
  {
    key: "subtitle",
    label: "字幕",
    group: "高级选项",
    desc: "外挂字幕的识别、归类与重命名",
    fields: ["sub_type", "subtitle_folder", "subtitle_add", "subtitle_add_chs", "subtitle_add_rescrape"],
  },
  {
    key: "files",
    label: "文件处理与更新",
    group: "高级选项",
    desc: "刮削时的文件读写细节、更新模式的目录规则与图片来源",
    fields: [
      "softlink_path",
      "extrafanart_folder",
      "scrape_softlink_path",
      "thread_time",
      "javdb_time",
      "main_mode",
      "read_mode",
      "update_mode",
      "update_a_folder",
      "update_b_folder",
      "update_c_filetemplate",
      "update_d_folder",
      "update_titletemplate",
      "soft_link",
      "success_file_rename",
      "del_empty_folder",
      "show_poster",
      "keep_files",
      "download_hd_pics",
      "google_used",
      "google_exclude",
    ],
  },
  {
    key: "cleaning",
    label: "清理规则",
    group: "高级选项",
    desc: "刮削前自动清理广告文件、垃圾文件和排除目录",
    fields: [
      "folders",
      "string",
      "file_size",
      "no_escape",
      "clean_ext",
      "clean_name",
      "clean_contains",
      "clean_size",
      "clean_ignore_ext",
      "clean_ignore_contains",
      "clean_enable",
    ],
  },
  {
    key: "watermark",
    label: "水印",
    group: "高级选项",
    desc: "在海报/缩略图上叠加 中文字幕、无码破解 等角标",
    fields: [
      "poster_mark",
      "thumb_mark",
      "fanart_mark",
      "mark_size",
      "mark_type",
      "mark_fixed",
      "mark_pos",
      "mark_pos_corner",
      "mark_pos_sub",
      "mark_pos_mosaic",
      "mark_pos_hd",
    ],
  },
  {
    key: "log",
    label: "日志",
    group: "高级选项",
    desc: "网页日志页显示哪些内容",
    fields: ["show_web_log", "show_from_log", "show_data_log", "save_log"],
  },
  {
    key: "misc",
    label: "杂项",
    group: "高级选项",
    desc: "其余零散选项; 未归类的字段也会出现在这里",
    fields: [
      "update_check",
      "local_library",
      "actors_name",
      "netdisk_path",
      "localdisk_path",
      "window_title",
      "switch_on",
      "timed_interval",
      "rest_count",
      "rest_time",
    ],
  },
];

/**
 * 构造当前分区的 uiSchema:
 * - 分区内的字段沿用服务端 uiSchema(如 serverPath 自定义控件)
 * - 其余字段全部隐藏, 但值仍随草稿保留, 提交时不会丢
 */
function buildSectionUiSchema(
  baseUiSchema: UiSchema | undefined,
  shownFields: string[],
  allFieldNames: string[],
): UiSchema {
  const base = (baseUiSchema ?? {}) as Record<string, UiSchema>;
  const shown = new Set(shownFields);
  const ui: Record<string, UiSchema> = {};
  for (const name of allFieldNames) {
    if (shown.has(name)) {
      ui[name] = base[name] ?? {};
    } else {
      // 隐藏字段不能再挂自定义 field 控件, 否则 ui:field 会优先于 hidden 渲染
      const { "ui:field": _drop, ...rest } = base[name] ?? {};
      ui[name] = { ...rest, "ui:widget": "hidden" };
    }
  }
  return ui;
}

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

  // 分区导航: schema 里实际存在的字段才参与渲染; 未归入任何分区的新字段自动落到「杂项」
  const allFieldNames = useMemo(
    () => (schemaQ.data ? Object.keys((schemaQ.data as RJSFSchema).properties ?? {}) : []),
    [schemaQ.data],
  );
  const extraFields = useMemo(() => {
    const covered = new Set([...SECTIONS.flatMap((s) => s.fields), ...HIDDEN_FIELDS]);
    return allFieldNames.filter((n) => !covered.has(n));
  }, [allFieldNames]);
  const [activeKey, setActiveKey] = useState(SECTIONS[0].key);
  const activeSection = SECTIONS.find((s) => s.key === activeKey) ?? SECTIONS[0];
  const shownFields = activeSection.key === "misc" ? [...activeSection.fields, ...extraFields] : activeSection.fields;
  const sectionUiSchema = useMemo(
    () => buildSectionUiSchema(uiSchemaQ.data, shownFields, allFieldNames),
    [uiSchemaQ.data, shownFields, allFieldNames],
  );

  const sectionNav = (
    <Paper
      variant="outlined"
      sx={{
        width: 210,
        flexShrink: 0,
        position: "sticky",
        top: 88,
        maxHeight: "calc(100vh - 120px)",
        overflowY: "auto",
        alignSelf: "flex-start",
      }}
    >
      <List dense disablePadding>
        {(["常用设置", "高级选项"] as const).map((group) => (
          <Box key={group}>
            <Typography variant="overline" sx={{ px: 2, pt: 1.5, display: "block", color: "text.secondary" }}>
              {group}
            </Typography>
            {SECTIONS.filter((s) => s.group === group).map((s) => (
              <ListItemButton key={s.key} selected={s.key === activeKey} onClick={() => setActiveKey(s.key)}>
                <ListItemText primary={s.label} slotProps={{ primary: { variant: "body2" } }} />
              </ListItemButton>
            ))}
          </Box>
        ))}
      </List>
      <Divider />
      <Typography variant="caption" color="text.secondary" sx={{ px: 2, py: 1, display: "block" }}>
        不确定含义的选项保持默认即可
      </Typography>
    </Paper>
  );

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
      <Box
        className="p-2"
        // 修复遗留问题: rjsf 分组标题把 body 撑出横向滚动条
        sx={{ maxWidth: "100%", overflowX: "hidden", "& .MuiTypography-h5": { overflowWrap: "anywhere" } }}
      >
        <ConfigManagerBar
          onConfigReplaced={(next) => {
            // 切换/重置后, 草稿和基线都换成新配置, 避免旧草稿被误保存到新配置
            setDraft(next);
            setBaseline(stableStringify(next));
          }}
        />
        <Stack direction="row" spacing={2} alignItems="flex-start">
          {sectionNav}
          <Box flexGrow={1} minWidth={0}>
            {activeSection && (
              <Box>
                <Typography variant="h5" sx={{ mb: 0.5 }}>
                  {activeSection.label}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  {activeSection.desc}
                </Typography>
                <FormControl fullWidth sx={{ mb: 2 }}>
                  <Form
                    key={activeSection.key}
                    // 根标题 "Config" 与分区标题重复, 去掉
                    schema={{ ...schemaQ.data, title: undefined } as RJSFSchema}
                    uiSchema={sectionUiSchema}
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
                          有未保存的修改(切换分区不会丢失)
                        </Typography>
                      )}
                      <Button type="submit" variant="contained" disabled={saveConfig.isPending || !dirty}>
                        {saveConfig.isPending ? "保存中..." : "保存"}
                      </Button>
                    </Stack>
                  </Form>
                </FormControl>
              </Box>
            )}
          </Box>
        </Stack>
      </Box>
    )
  );
}
