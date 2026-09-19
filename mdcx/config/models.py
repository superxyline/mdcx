import re
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import timedelta
from functools import lru_cache
from typing import TYPE_CHECKING, Any, Literal, cast

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, field_validator
from pydantic.fields import FieldInfo

from ..gen.field_enums import CrawlerResultFields
from ..manual import ManualConfig
from ..server.config import SAFE_DIRS
from .enums import (
    CDChar,
    CleanAction,
    DownloadableFile,
    EmbyAction,
    FieldRule,
    HDPicSource,
    KeepableFile,
    Language,
    MarkType,
    NfoInclude,
    NoEscape,
    OutlineShow,
    ReadMode,
    SuffixSort,
    Switch,
    TagInclude,
    Translator,
    Website,
)
from .ui_schema import ServerPathDirectory, extract_ui_schema_recursive


def str_to_list(v: str | list[Any] | None, sep: Literal[",", "|"] = ",", unique: bool = True) -> list[str]:
    """
    将字符串转换为列表.
    支持全/半角逗号或竖线作为分隔符, 将去除每项首尾的空白符, 去空, 去重.
    """
    if v is None:
        return []
    if isinstance(v, list):
        return [str(item) for item in v]
    if isinstance(v, str):
        if sep == ",":
            v = v.replace("，", ",")
        elif sep == "|":
            v = v.replace("｜", "|")
        if unique:
            return list(dict.fromkeys([item.strip() for item in v.strip(sep).split(sep) if item.strip()]))
        return [item.strip() for item in v.strip(sep).split(sep) if item.strip()]
    return []


class TranslateConfig(BaseModel):
    translate_by: list[Translator] = Field(
        default_factory=lambda: [Translator.YOUDAO, Translator.GOOGLE, Translator.DEEPL, Translator.LLM],
        title="翻译服务",
    )
    deepl_key: str = Field(default="", title="Deepl密钥")
    llm_url: HttpUrl = Field(default=HttpUrl("https://api.llm.com/v1"), title="LLM API Host")
    llm_model: str = Field(default="gpt-3.5-turbo", title="模型 ID")
    llm_key: str = Field(default="", title="LLM API Key")
    llm_prompt: str = Field(
        default="Please translate the following text to {lang}. Output only the translation without any explanation.\n{content}",
        title="LLM 提示词",
    )
    llm_read_timeout: int = Field(default=60, title="LLM 读取超时 (秒)", description="LLM 生成耗时较长, 建议设置较大值")
    llm_max_req_sec: float = Field(default=1, title="LLM 每秒最大请求数")
    llm_max_try: int = Field(default=5, title="LLM 最大尝试次数")
    llm_temperature: float = Field(default=0.2, title="LLM 温度")

    def model_post_init(self, context) -> None:
        if self.llm_max_req_sec <= 0:
            self.llm_max_req_sec = 1


class SiteConfig(BaseModel):
    use_browser: bool = Field(default=False, title="使用无头浏览器")
    custom_url: HttpUrl | None = Field(default=None, title="自定义网址")


class FieldConfig(BaseModel):
    site_prority: list[Website] = Field(default_factory=list, title="来源网站优先级")
    language: Language = Field(default=Language.UNDEFINED, title="语言偏好")
    translate: bool = Field(
        default=True,
        title="翻译此字段",
        description="若启用则使用首个来源的数据并翻译为指定语言; 否则使用第一个指定语言的数据, 如果所有来源都没有指定语言数据则视为失败.",
    )


class Config(BaseModel):
    model_config = ConfigDict()
    # region: General Settings
    # 默认指向容器内媒体库挂载点, 与 docker-compose.yml 的挂载保持一致
    media_path: str = ServerPathDirectory(
        "/media",
        title="媒体路径",
        description="影片所在的目录, 刮削程序会从这里扫描视频文件",
        initial_path=SAFE_DIRS[0].as_posix(),
    )
    softlink_path: str = ServerPathDirectory("softlink", title="软链接路径", ref_field="media_path")
    success_output_folder: str = ServerPathDirectory(
        "JAV_output",
        title="成功输出目录",
        description="刮削成功的影片整理后存放的目录",
        ref_field="media_path",
    )
    failed_output_folder: str = ServerPathDirectory(
        "failed",
        title="失败输出目录",
        description="刮削失败(识别不出番号等)的文件移到这里等待人工处理",
        ref_field="media_path",
    )
    extrafanart_folder: str = ServerPathDirectory("extrafanart_copy", title="额外剧照目录")
    media_type: list[str] = Field(
        default_factory=lambda: [
            ".mp4",
            ".avi",
            ".rmvb",
            ".wmv",
            ".mov",
            ".mkv",
            ".flv",
            ".ts",
            ".webm",
            ".iso",
            ".mpg",
        ],
        title="媒体类型",
        description="只刮削这些扩展名的视频文件, 其他文件会被忽略",
    )
    sub_type: list[str] = Field(
        default_factory=lambda: [
            ".smi",
            ".srt",
            ".idx",
            ".sub",
            ".sup",
            ".psb",
            ".ssa",
            ".ass",
            ".usf",
            ".xss",
            ".ssf",
            ".rt",
            ".lrc",
            ".sbv",
            ".vtt",
            ".ttml",
        ],
        title="字幕类型",
    )
    scrape_softlink_path: bool = Field(default=False, title="刮削软链接路径")
    auto_link: bool = Field(
        default=False,
        title="自动创建软链接",
        description="刮削完成后在软链接路径生成指向影片的软链接, 适合给媒体服务器单独挂载",
    )
    # endregion

    # region: Cleaning Settings
    folders: list[str] = Field(default_factory=lambda: ["JAV_output", "examples"], title="排除的目录")
    string: list[str] = Field(
        default_factory=lambda: [
            "h_720",
            "2048论坛@fun2048.com",
            "1080p",
            "720p",
            "22-sht.me",
            "-HD",
            "bbs2048.org@",
            "hhd800.com@",
            "icao.me@",
            "hhb_000",
            "[456k.me]",
            "[ThZu.Cc]",
        ],
        title="要从文件名中删除的字符串",
    )
    file_size: float = Field(default=100.0, title="要处理的最小文件大小（MB）")
    no_escape: list[NoEscape] = Field(
        default_factory=lambda: [NoEscape.RECORD_SUCCESS_FILE],
        title="不转义的字符串",
    )
    clean_ext: list[str] = Field(
        default_factory=lambda: [".html", ".url"],
        title="清理规则: 扩展名",
    )
    clean_name: list[str] = Field(
        default_factory=lambda: ["uur76.mp4", "uur93.com.mp4"],
        title="清理规则: 文件名(完全匹配)",
    )
    clean_contains: list[str] = Field(
        default_factory=lambda: [
            "直播盒子",
            "最新情报",
            "最新位址",
            "注册免费送",
            "房间火爆",
            "美女荷官",
            "妹妹直播",
            "精彩直播",
        ],
        title="清理规则: 文件名包含",
    )
    clean_size: float = Field(default=0.0, title="清理小于此大小的文件（KB）")
    clean_ignore_ext: list[str] = Field(
        default_factory=list,
        title="清理规则: 排除扩展名",
    )
    clean_ignore_contains: list[str] = Field(
        default_factory=lambda: ["skip", "ignore"],
        title="清理规则: 排除文件名包含",
    )
    clean_enable: list[CleanAction] = Field(
        default_factory=lambda: [
            CleanAction.CLEAN_EXT,
            CleanAction.CLEAN_NAME,
            CleanAction.CLEAN_CONTAINS,
            CleanAction.CLEAN_SIZE,
            CleanAction.CLEAN_IGNORE_EXT,
            CleanAction.CLEAN_IGNORE_CONTAINS,
        ],
        title="启用的清理规则",
    )
    # endregion

    # region: Scraping Settings
    thread_number: int = Field(
        default=50,
        title="并发数",
        description="同时刮削的影片数量. NAS 性能有限或频繁超时时建议调低(如 20)",
    )
    thread_time: int = Field(default=0, title="线程时间")
    javdb_time: int = Field(default=10, title="Javdb时间")
    main_mode: int = Field(default=1, title="主模式")
    read_mode: list[ReadMode] = Field(default_factory=list, title="读取模式")
    update_mode: str = Field(default="c", title="更新模式")
    update_a_folder: str = Field(default="actor", title="更新A目录")
    update_b_folder: str = Field(default="number actor", title="更新B目录")
    update_c_filetemplate: str = Field(default="number", title="更新C文件模板")
    update_d_folder: str = Field(default="number actor", title="更新D目录")
    update_titletemplate: str = Field(default="number title", title="更新标题模板")
    soft_link: int = Field(default=0, title="软链接")
    success_file_move: bool = Field(
        default=True,
        title="成功后移动文件",
        description="开启后刮削成功的影片会被移动到成功输出目录; 关闭则留在原地只生成元数据",
    )
    failed_file_move: bool = Field(
        default=True,
        title="失败后移动文件",
        description="开启后刮削失败的文件会被移动到失败输出目录; 关闭则留在原地",
    )
    success_file_rename: bool = Field(default=True, title="成功后重命名文件")
    del_empty_folder: bool = Field(default=True, title="删除空目录")
    show_poster: bool = Field(default=True, title="显示海报")
    download_files: list[DownloadableFile] = Field(
        # 默认不含 预告片/主题片/原始剧照/剧照附加: 它们会被媒体库识别成额外条目
        # 默认不含 IGNORE_YOUMA/WUMA/FC2/GUOCHAN: 它们会让对应类型的封面跳过裁剪, 直接复制横版原图
        default_factory=lambda: [
            DownloadableFile.POSTER,
            DownloadableFile.THUMB,
            DownloadableFile.FANART,
            DownloadableFile.NFO,
            DownloadableFile.EXTRAFANART_COPY,
            DownloadableFile.IGNORE_PIC_FAIL,
            DownloadableFile.IGNORE_SIZE,
        ],
        title="下载文件类型",
        description="刮削时要下载保存的内容, 建议至少勾选 海报/缩略图/剧照/Nfo",
    )
    keep_files: list[KeepableFile] = Field(
        default_factory=lambda: [
            KeepableFile.POSTER,
            KeepableFile.THUMB,
            KeepableFile.FANART,
            KeepableFile.EXTRAFANART,
            KeepableFile.NFO,
            KeepableFile.EXTRAFANART_COPY,
        ],
        title="保留文件类型",
    )
    download_hd_pics: list[HDPicSource] = Field(
        default_factory=lambda: [HDPicSource.POSTER, HDPicSource.THUMB, HDPicSource.GOO_ONLY],
        title="高清图片来源",
    )
    google_used: list[str] = Field(
        default_factory=lambda: ["m.media-amazon.com"],
        title="Google使用",
    )
    google_exclude: list[str] = Field(
        default_factory=lambda: [
            "fake",
            "javfree",
            "idoljp.com",
            "qqimg.top",
            "u9a9",
            "picturedata",
            "abpic",
            "pbs.twimg.com",
            "naiwarp",
        ],
        title="Google搜图排除的网址",
    )
    scrape_like: Literal["info", "speed", "single"] = Field(
        default="info",
        title="刮削模式",
        description="info=完整刮削(推荐), speed=快速模式(少等超时), single=单文件模式",
    )  # speed, info, single
    # endregion

    # region: Website Settings
    website_single: Website = Field(default=Website.AIRAV_CC, title="单个网站")  # todo 移除
    website_youma: set[Website] = Field(
        default_factory=lambda: {
            Website.OFFICIAL,
            Website.IQQTV,
            Website.AVSEX,
            Website.AVSOX,
            Website.CABLEAV,
            Website.DMM,
            Website.FALENO,
            Website.FANTASTICA,
            Website.GIGA,
            Website.JAV321,
            Website.JAVBUS,
            Website.JAVDAY,
            Website.JAVDB,
            Website.LOVE6,
            Website.LULUBAR,
            Website.MGSTAGE,
            Website.MYWIFE,
            Website.PRESTIGE,
            Website.XCITY,
        },
        title="有码网站源",
    )
    website_wuma: set[Website] = Field(
        default_factory=lambda: {
            Website.IQQTV,
            Website.JAVBUS,
            Website.FREEJAVBT,
            Website.JAV321,
            Website.AVSOX,
            Website.MMTV,
            Website.HDOUBAN,
            Website.JAVDB,
            Website.AIRAV,
        },
        title="无码网站源",
    )
    website_suren: set[Website] = Field(
        default_factory=lambda: {
            Website.MGSTAGE,
            Website.AVSEX,
            Website.JAV321,
            Website.FREEJAVBT,
            Website.MMTV,
            Website.JAVBUS,
            Website.JAVDB,
        },
        title="素人网站源",
    )
    website_fc2: set[Website] = Field(
        default_factory=lambda: {
            Website.FC2,
            Website.FC2CLUB,
            Website.FC2HUB,
            Website.FREEJAVBT,
            Website.MMTV,
            Website.HDOUBAN,
            Website.JAVDB,
            Website.AVSOX,
            Website.AIRAV,
        },
        title="FC2网站源",
    )
    website_oumei: set[Website] = Field(
        default_factory=lambda: {Website.THEPORNDB, Website.JAVDB, Website.JAVBUS, Website.HDOUBAN},
        title="欧美网站源",
    )
    website_guochan: set[Website] = Field(
        default_factory=lambda: {Website.MADOUQU, Website.MDTV, Website.HDOUBAN, Website.CNMDB, Website.JAVDAY},
        title="国产网站源",
    )

    title_sehua: bool = Field(default=True, title="使用色花标题")
    title_yesjav: bool = Field(default=False, title="使用 Yesjav 标题")
    title_sehua_zh: bool = Field(default=True, title="使用色花中文标题")
    actor_realname: bool = Field(default=True, title="演员真名")
    outline_format: list[OutlineShow] = Field(default_factory=list, title="简介格式")
    # endregion

    field_configs: dict[CrawlerResultFields, FieldConfig] = Field(
        # 站点顺序按实测可用性排列: OFFICIAL 最权威; JAVBUS/JAV321 稳定且提供封面与剧照;
        # JAVDB 需要 Cookie; DMM 需要无头浏览器。原默认以 THEPORNDB 打头, 但它需 API token
        # 且是欧美站, 对日本作品无数据, 每次都要白等一次超时才落到下一个站点。
        default_factory=lambda: {
            CrawlerResultFields.TITLE: FieldConfig(
                site_prority=[Website.OFFICIAL, Website.JAVBUS, Website.JAV321, Website.JAVDB, Website.DMM],
                language=Language.ZH_CN,
            ),
            CrawlerResultFields.ORIGINALTITLE: FieldConfig(
                site_prority=[Website.OFFICIAL, Website.JAVBUS, Website.JAV321, Website.JAVDB, Website.DMM],
                language=Language.ZH_CN,
            ),
            CrawlerResultFields.OUTLINE: FieldConfig(
                site_prority=[Website.OFFICIAL, Website.JAVBUS, Website.JAV321, Website.JAVDB, Website.DMM],
                language=Language.ZH_CN,
            ),
            CrawlerResultFields.ORIGINALPLOT: FieldConfig(
                site_prority=[Website.OFFICIAL, Website.JAVBUS, Website.JAV321, Website.JAVDB, Website.DMM],
                language=Language.ZH_CN,
            ),
            CrawlerResultFields.ACTORS: FieldConfig(
                site_prority=[Website.OFFICIAL, Website.JAVBUS, Website.JAV321, Website.JAVDB, Website.DMM],
                language=Language.JP,
            ),
            CrawlerResultFields.ALL_ACTORS: FieldConfig(
                site_prority=[Website.JAVBUS, Website.JAVDB, Website.JAV321],
                language=Language.JP,
            ),
            CrawlerResultFields.TAGS: FieldConfig(
                site_prority=[Website.OFFICIAL, Website.JAVBUS, Website.JAV321, Website.JAVDB, Website.DMM],
                language=Language.ZH_CN,
            ),
            CrawlerResultFields.DIRECTORS: FieldConfig(
                site_prority=[Website.OFFICIAL, Website.JAVBUS, Website.JAV321, Website.JAVDB, Website.DMM],
                language=Language.JP,
            ),
            CrawlerResultFields.SERIES: FieldConfig(
                site_prority=[Website.OFFICIAL, Website.JAVBUS, Website.JAV321, Website.JAVDB, Website.DMM],
                language=Language.JP,
            ),
            CrawlerResultFields.STUDIO: FieldConfig(
                site_prority=[Website.OFFICIAL, Website.JAVBUS, Website.JAV321, Website.JAVDB, Website.DMM],
                language=Language.JP,
            ),
            CrawlerResultFields.PUBLISHER: FieldConfig(
                site_prority=[Website.OFFICIAL, Website.JAVBUS, Website.JAV321, Website.JAVDB, Website.DMM],
                language=Language.JP,
            ),
            CrawlerResultFields.THUMB: FieldConfig(site_prority=[Website.JAVBUS, Website.DMM, Website.THEPORNDB]),
            CrawlerResultFields.POSTER: FieldConfig(site_prority=[Website.JAVBUS, Website.DMM, Website.THEPORNDB]),
            CrawlerResultFields.EXTRAFANART: FieldConfig(
                site_prority=[Website.JAVBUS, Website.DMM, Website.THEPORNDB]
            ),
            CrawlerResultFields.TRAILER: FieldConfig(
                site_prority=[Website.OFFICIAL, Website.JAVBUS, Website.JAV321, Website.JAVDB, Website.DMM]
            ),
            CrawlerResultFields.RELEASE: FieldConfig(
                site_prority=[Website.OFFICIAL, Website.JAVBUS, Website.JAV321, Website.JAVDB, Website.DMM]
            ),
            CrawlerResultFields.RUNTIME: FieldConfig(
                site_prority=[Website.OFFICIAL, Website.JAVBUS, Website.JAV321, Website.JAVDB, Website.DMM]
            ),
            CrawlerResultFields.SCORE: FieldConfig(site_prority=[Website.JAVBUS, Website.JAVDB, Website.DMM]),
            CrawlerResultFields.WANTED: FieldConfig(site_prority=[Website.DMM, Website.JAVDB]),
        },
        title="字段配置",
    )

    site_configs: dict[Website, SiteConfig] = Field(
        default_factory=lambda: {
            Website.DMM: SiteConfig(use_browser=True),
        },
        title="网站配置",
    )

    translate_config: TranslateConfig = Field(default_factory=TranslateConfig, title="翻译配置")

    # region: Naming and Formatting
    nfo_include_new: list[NfoInclude] = Field(
        default_factory=lambda: [
            NfoInclude.SORTTITLE,
            NfoInclude.ORIGINALTITLE,
            NfoInclude.TITLE_CD,
            NfoInclude.OUTLINE,
            NfoInclude.PLOT_,
            NfoInclude.ORIGINALPLOT,
            NfoInclude.OUTLINE_NO_CDATA,
            NfoInclude.RELEASE_,
            NfoInclude.RELEASEDATE,
            NfoInclude.PREMIERED,
            NfoInclude.COUNTRY,
            NfoInclude.MPAA,
            NfoInclude.CUSTOMRATING,
            NfoInclude.YEAR,
            NfoInclude.RUNTIME,
            NfoInclude.WANTED,
            NfoInclude.SCORE,
            NfoInclude.CRITICRATING,
            NfoInclude.ACTOR,
            NfoInclude.ACTOR_ALL,
            NfoInclude.DIRECTOR,
            NfoInclude.SERIES,
            NfoInclude.TAG,
            NfoInclude.GENRE,
            NfoInclude.ACTOR_SET,
            NfoInclude.SERIES_SET,
            NfoInclude.STUDIO,
            NfoInclude.MAKER,
            NfoInclude.PUBLISHER,
            NfoInclude.LABEL,
            NfoInclude.POSTER,
            NfoInclude.COVER,
            NfoInclude.TRAILER,
            NfoInclude.WEBSITE,
        ],
        title="NFO包含内容",
    )
    nfo_tagline: str = Field(default="发行日期 release", title="NFO标语")
    nfo_tag_include: list[TagInclude] = Field(
        default_factory=lambda: [
            TagInclude.ACTOR,
            TagInclude.LETTERS,
            TagInclude.SERIES,
            TagInclude.STUDIO,
            TagInclude.PUBLISHER,
            TagInclude.CNWORD,
            TagInclude.MOSAIC,
            TagInclude.DEFINITION,
        ],
        title="包含标签",
    )
    nfo_tag_series: str = Field(default="系列: series", title="NFO系列标签")
    nfo_tag_studio: str = Field(default="片商: studio", title="NFO工作室标签")
    nfo_tag_publisher: str = Field(default="发行: publisher", title="NFO发行商标签")
    nfo_tag_actor: str = Field(default="actor", title="NFO演员标签")
    nfo_tag_actor_contains: list[str] = Field(default_factory=list, title="NFO 演员名白名单")
    folder_name: str = Field(default="actor/number actor", title="目录名称")
    naming_file: str = Field(default="number", title="文件命名")
    naming_media: str = Field(default="number title", title="媒体命名")
    prevent_char: str = Field(default="", title="禁止字符")
    fields_rule: list[FieldRule] = Field(
        default_factory=lambda: [FieldRule.DEL_ACTOR, FieldRule.DEL_CHAR, FieldRule.FC2_SELLER, FieldRule.DEL_NUM],
        title="字段规则",
    )
    suffix_sort: list[SuffixSort] = Field(
        # 默认不追加任何后缀, 文件名保持纯番号
        default_factory=list,
        title="后缀排序",
    )
    actor_no_name: str = Field(default="未知演员", title="未知演员名称")
    release_rule: str = Field(default="YYYY-MM-DD", title="发布规则")
    folder_name_max: int = Field(default=60, title="目录名称最大长度")
    file_name_max: int = Field(default=60, title="文件名称最大长度")
    actor_name_max: int = Field(default=3, title="演员名称最大数量")
    actor_name_more: str = Field(default="等演员", title="更多演员名称")
    umr_style: str = Field(default="-破解", title="UMR样式")
    leak_style: str = Field(default="-流出", title="泄露样式")
    wuma_style: str = Field(default="", title="无码样式")
    youma_style: str = Field(default="", title="有码样式")
    cd_name: int = Field(default=0, title="CD名称")
    cd_char: list[CDChar] = Field(
        # 不含 ENDC: 字母 c 通常是中文字幕标记(见 cnword_char), 不应被当成"第3集"
        default_factory=lambda: [
            CDChar.LETTER,
            CDChar.DIGITAL,
            CDChar.MIDDLE_NUMBER,
            CDChar.UNDERLINE,
            CDChar.SPACE,
            CDChar.POINT,
        ],
        title="分集规则",
    )
    pic_simple_name: bool = Field(default=False, title="图片简化命名")
    trailer_simple_name: bool = Field(default=True, title="预告片简化命名")
    hd_name: Literal["height", "hd"] = Field(default="height", title="高清名称")
    hd_get: Literal["video", "path", "none"] = Field(default="video", title="获取高清")
    cnword_char: list[str] = Field(default_factory=lambda: ["-C.", "-C-", "ch.", "字幕"], title="中文字符")
    cnword_style: str = Field(default="-C", title="中文样式")
    folder_cnword: bool = Field(default=True, title="目录中文")
    file_cnword: bool = Field(default=True, title="文件中文")
    subtitle_folder: str = Field(default="", title="字幕目录")
    subtitle_add: bool = Field(default=False, title="添加字幕")
    subtitle_add_chs: bool = Field(default=True, title="添加中文字幕")
    subtitle_add_rescrape: bool = Field(default=True, title="重新刮削时添加字幕")
    # endregion

    # region: Server Settings
    server_type: Literal["emby", "jellyfin"] = Field(default="emby", title="服务器类型")
    emby_url: HttpUrl = Field(
        default=HttpUrl("http://127.0.0.1:8096"),
        title="Emby网址",
        description="媒体服务器的访问地址, 如 http://192.168.31.10:8096",
    )
    api_key: str = Field(
        default="",
        title="API密钥",
        description="在媒体服务器 控制台→API密钥 里生成, 用于刮削后刷新媒体库和补全演员信息",
    )
    user_id: str = Field(
        default="",
        title="用户ID",
        description="媒体服务器的用户 ID, 可在 控制台→设备 或用户管理页的链接里找到",
    )
    emby_refresh: bool = Field(
        default=False,
        title="刮削后刷新媒体库",
        description="每轮刮削完成后自动调用媒体服务器的刷新接口, 新片几秒内即可入库; 需先填好上面的地址和 API密钥",
    )
    emby_on: list[EmbyAction] = Field(
        default_factory=lambda: [
            EmbyAction.ACTOR_INFO_ZH_CN,
            EmbyAction.ACTOR_INFO_MISS,
            EmbyAction.ACTOR_PHOTO_NET,
            EmbyAction.ACTOR_PHOTO_MISS,
            EmbyAction.ACTOR_INFO_TRANSLATE,
            EmbyAction.ACTOR_INFO_PHOTO,
            EmbyAction.GRAPHIS_BACKDROP,
            EmbyAction.GRAPHIS_FACE,
            EmbyAction.GRAPHIS_NEW,
            EmbyAction.ACTOR_PHOTO_AUTO,
            EmbyAction.ACTOR_REPLACE,
        ],
        title="Emby功能开关",
    )
    use_database: bool = Field(default=False, title="使用数据库")
    info_database_path: str = Field(default="", title="信息数据库路径")
    gfriends_github: HttpUrl = Field(default=HttpUrl("https://github.com/gfriends/gfriends"), title="Gfriends Github")
    actor_photo_folder: str = Field(default="", title="演员照片目录")
    actor_photo_kodi_auto: bool = Field(default=False, title="演员照片Kodi自动")
    # endregion

    # region: Watermark Settings
    poster_mark: int = Field(default=1, title="海报水印")
    thumb_mark: int = Field(default=1, title="缩略图水印")
    fanart_mark: int = Field(default=0, title="Fanart水印")
    mark_size: int = Field(default=5, title="水印大小")
    mark_type: list[MarkType] = Field(
        default_factory=lambda: [
            MarkType.SUB,
            MarkType.YOUMA,
            MarkType.UMR,
            MarkType.LEAK,
            MarkType.UNCENSORED,
            MarkType.HD,
        ],
        title="水印类型",
    )
    mark_fixed: Literal["not_fixed", "fixed", "corner"] = Field(
        default="not_fixed",
        title="水印添加规则",
        description="not_fixed: 不固定位置. 将从首个位置开始顺时针方向依次添加; fixed: 固定一个位置, 水印在此依次横向添加; corner: 分别设置不同种类水印的位置.",
    )
    mark_pos: str = Field(default="top_left", title="水印规则为不固定时首个水印的位置")
    mark_pos_corner: str = Field(default="top_left", title="水印规则为固定时的位置")
    mark_pos_sub: str = Field(default="top_left", title="中文字幕水印位置")
    mark_pos_mosaic: str = Field(default="top_right", title="马赛克类型水印位置")
    mark_pos_hd: str = Field(default="bottom_right", title="清晰度水印位置")
    # endregion

    # region: Network Settings
    use_proxy: bool = Field(
        default=False,
        title="使用代理",
        description="刮削源在国内无法直连时开启; Docker 部署时 compose 里已内置 clash 容器, 地址填 http://mdcx-clash:7890",
    )
    proxy: str = Field(
        default="http://127.0.0.1:7890",
        title="代理地址",
        description="HTTP 代理地址, 格式 http://主机:端口",
    )
    timeout: int = Field(
        default=10,
        title="超时",
        description="单个网络请求的超时秒数, 网络慢时可调大",
    )
    retry: int = Field(
        default=3,
        title="重试",
        description="请求失败后的重试次数",
    )
    theporndb_api_token: str = Field(default="", title="Theporndb API令牌")
    javdb: str = Field(default="", title="Javdb")
    javbus: str = Field(default="", title="Javbus")
    # endregion

    # region: Notify Settings
    notify_type: Literal["none", "bark", "telegram"] = Field(
        default="none",
        title="完成通知方式",
        description="每轮刮削结束后推送结果统计到手机",
    )
    bark_url: str = Field(
        default="https://api.day.app",
        title="Bark 服务器地址",
        description="自建 Bark 服务器时改成自己的地址, 默认官方即可",
    )
    bark_key: str = Field(
        default="",
        title="Bark 推送 Key",
        description="Bark App 首页复制的那串 Key",
    )
    telegram_bot_token: str = Field(
        default="",
        title="Telegram Bot Token",
        description="找 @BotFather 创建机器人后获得; 国内直连不通, 请在代理与网络里开启代理",
    )
    telegram_chat_id: str = Field(
        default="",
        title="Telegram Chat ID",
        description="给机器人发过消息后, 用 @userinfobot 查询自己的 ID",
    )
    # endregion

    # region: Log Settings
    show_web_log: bool = Field(default=False, title="显示网页日志")
    show_from_log: bool = Field(default=True, title="显示来源日志")
    show_data_log: bool = Field(default=True, title="显示数据日志")
    save_log: bool = Field(default=True, title="保存日志")
    # endregion

    # region: Misc Settings
    update_check: bool = Field(default=True, title="检查更新")
    # 首次使用引导向导是否已完成; 完成或跳过后置 true, 不再弹出
    wizard_done: bool = Field(default=False, title="初始化向导已完成")
    local_library: list[str] = Field(default_factory=list, title="本地库")
    actors_name: str = Field(default="", title="演员名称")
    netdisk_path: str = Field(default="", title="网盘路径")
    localdisk_path: str = Field(default="", title="本地磁盘路径")
    window_title: str = Field(default="hide", title="窗口标题")
    switch_on: list[Switch] = Field(
        default_factory=lambda: [
            Switch.AUTO_EXIT,
            Switch.REST_SCRAPE,
            Switch.TIMED_SCRAPE,
            Switch.REMAIN_TASK,
            Switch.SHOW_DIALOG_STOP_SCRAPE,
            Switch.SORT_DEL,
            Switch.THEPORNDB_NO_HASH,
            Switch.HIDE_DOCK,
            Switch.PASSTHROUGH,
            Switch.HIDE_MENU,
            Switch.DARK_MODE,
            Switch.COPY_NETDISK_NFO,
            Switch.SHOW_LOGS,
            Switch.HIDE_NONE,
        ],
        title="功能开关",
    )
    timed_interval: timedelta = Field(default=timedelta(minutes=30), title="定时器间隔")
    rest_count: int = Field(default=20, title="休息计数")
    rest_time: timedelta = Field(default=timedelta(), title="休息时间")
    # statement: int = Field(default=3, title="声明")
    # endregion

    # region: deperated
    # website_set: list[WebsiteSet] = Field(default_factory=list, title="网站设置")
    # whole_fields: list[WholeField] = Field(default_factory=list, title="完整字段")
    # none_fields: list[NoneField] = Field(default_factory=list, title="空字段")
    # title_website: list[Website] = Field(default_factory=list, title="标题网站源")
    # title_zh_website: list[Website] = Field(default_factory=list, title="中文标题网站源")
    # title_website_exclude: list[Website] = Field(default_factory=list, title="排除的标题网站源")
    # outline_website: list[Website] = Field(default_factory=list, title="简介网站源")
    # outline_zh_website: list[Website] = Field(default_factory=list, title="中文简介网站源")
    # outline_website_exclude: list[Website] = Field(default_factory=list, title="排除的简介网站源")
    # actor_website: list[Website] = Field(default_factory=list, title="演员网站源")
    # actor_website_exclude: list[Website] = Field(default_factory=list, title="排除的演员网站源")
    # thumb_website: list[Website] = Field(default_factory=list, title="缩略图网站源")
    # thumb_website_exclude: list[Website] = Field(default_factory=list, title="排除的缩略图网站源")
    # poster_website: list[Website] = Field(default_factory=list, title="海报网站源")
    # poster_website_exclude: list[Website] = Field(default_factory=list, title="排除的海报网站源")
    # extrafanart_website: list[Website] = Field(default_factory=list, title="剧照网站源")
    # extrafanart_website_exclude: list[Website] = Field(default_factory=list, title="排除的剧照网站源")
    # trailer_website: list[Website] = Field(default_factory=list, title="预告片网站源")
    # trailer_website_exclude: list[Website] = Field(default_factory=list, title="排除的预告片网站源")
    # tag_website: list[Website] = Field(default_factory=list, title="标签网站源")
    # tag_website_exclude: list[Website] = Field(default_factory=list, title="排除的标签网站源")
    # release_website: list[Website] = Field(default_factory=list, title="发布日期网站源")
    # release_website_exclude: list[Website] = Field(default_factory=list, title="排除的发布日期网站源")
    # runtime_website: list[Website] = Field(default_factory=list, title="时长网站源")
    # runtime_website_exclude: list[Website] = Field(default_factory=list, title="排除的时长网站源")
    # score_website: list[Website] = Field(default_factory=list, title="评分网站源")
    # score_website_exclude: list[Website] = Field(default_factory=list, title="排除的评分网站源")
    # director_website: list[Website] = Field(default_factory=list, title="导演网站源")
    # director_website_exclude: list[Website] = Field(default_factory=list, title="排除的导演网站源")
    # series_website: list[Website] = Field(default_factory=list, title="系列网站源")
    # series_website_exclude: list[Website] = Field(default_factory=list, title="排除的系列网站源")
    # studio_website: list[Website] = Field(default_factory=list, title="工作室网站源")
    # studio_website_exclude: list[Website] = Field(default_factory=list, title="排除的工作室网站源")
    # publisher_website: list[Website] = Field(default_factory=list, title="发行商网站源")
    # publisher_website_exclude: list[Website] = Field(default_factory=list, title="排除的发行商网站源")
    # wanted_website: list[Website] = Field(default_factory=list, title="想看网站源")
    # title_language: Language = Field(default=Language.ZH_CN, title="标题语言")
    # title_translate: bool = Field(default=True, title="翻译标题")
    # outline_language: Language = Field(default=Language.ZH_CN, title="简介语言")
    # outline_translate: bool = Field(default=True, title="翻译简介")
    # actor_language: Language = Field(default=Language.ZH_CN, title="演员语言")
    # actor_translate: bool = Field(default=True, title="翻译演员")
    # tag_language: Language = Field(default=Language.ZH_CN, title="标签语言")
    # tag_translate: bool = Field(default=True, title="翻译标签")
    # director_language: Language = Field(default=Language.ZH_CN, title="导演语言")
    # director_translate: bool = Field(default=True, title="翻译导演")
    # series_language: Language = Field(default=Language.ZH_CN, title="系列语言")
    # series_translate: bool = Field(default=True, title="翻译系列")
    # studio_language: Language = Field(default=Language.ZH_CN, title="工作室语言")
    # studio_translate: bool = Field(default=True, title="翻译工作室")
    # publisher_language: Language = Field(default=Language.ZH_CN, title="发行商语言")
    # publisher_translate: bool = Field(default=True, title="翻译发行商")
    # endregion

    def get_site_config(self, site: Website) -> SiteConfig:
        return self.site_configs.get(site, SiteConfig())

    def get_site_url(self, site: Website, default: str = "") -> str:
        """获取指定网站的用户自定义 URL, 结尾无斜杠."""
        return str(self.get_site_config(site).custom_url or default).rstrip("/")

    def get_field_config(self, field: CrawlerResultFields) -> FieldConfig:
        return self.field_configs.get(field, FieldConfig())

    def set_field_sites(self, field: CrawlerResultFields, sites: list[Website] | str):
        sites = self.parse_sites(sites)
        self.field_configs.setdefault(field, FieldConfig()).site_prority = sites

    def set_field_language(self, field: CrawlerResultFields, language: Language):
        self.field_configs.setdefault(field, FieldConfig()).language = language

    def set_field_translate(self, field: CrawlerResultFields, translate: bool):
        self.field_configs.setdefault(field, FieldConfig()).translate = translate

    @staticmethod
    def parse_sites(sites: list | set | str) -> list[Website]:
        if isinstance(sites, str):
            sites = str_to_list(sites, ",")
        return [Website(s) for s in sites if s in Website]

    @staticmethod
    def update(d: dict[str, Any]) -> list[str]:
        """
        处理字段变更.
        """
        if "proxy_type" in d:
            d["use_proxy"] = d["proxy_type"] != "no"
        if isinstance(r := d.get("proxy"), str):
            r = r.strip()
            if all(schema not in r for schema in ["http://", "https://", "socks5://", "socks5h://"]):
                d["proxy"] = "http://" + r
        if isinstance(r := d.get("nfo_tag_actor_contains"), str):
            d["nfo_tag_actor_contains"] = str_to_list(r, "|")
        if isinstance(r := d.get("use_database"), int):
            d["use_database"] = bool(r)
        if isinstance(r := d.get("local_library"), str):
            d["local_library"] = str_to_list(r, ",")
        if "site_configs" not in d:
            d["site_configs"] = {Website.DMM: SiteConfig(use_browser=True)}
        elif Website.DMM not in d["site_configs"]:
            d["site_configs"][Website.DMM] = SiteConfig(use_browser=True)

        # 处理旧版字段设置
        if "field_configs" not in d:
            Config._convert_field_configs(d)

        return []

    @staticmethod
    def _convert_field_configs(d):
        field_configs: dict[CrawlerResultFields, FieldConfig] = {}
        whole_fields: list[str] = d.get("whole_fields", [])
        none_fields: list[str] = d.get("none_fields", [])
        website_youma = Config.parse_sites(d.get("website_youma", []))
        if len(d.get("website_set", [])) > 0:
            website_youma.insert(0, Website.OFFICIAL)
            d["website_youma"] = website_youma
        website_wuma = Config.parse_sites(d.get("website_wuma", []))
        website_suren = Config.parse_sites(d.get("website_suren", []))
        website_fc2 = Config.parse_sites(d.get("website_fc2", []))
        website_oumei = Config.parse_sites(d.get("website_oumei", []))
        website_guochan = Config.parse_sites(d.get("website_youma", []))
        all_enabled_sites = list(
            dict.fromkeys(website_youma + website_wuma + website_suren + website_fc2 + website_oumei + website_guochan)
        )
        for field_name in ManualConfig.CONFIG_DATA_FIELDS:
            if field_name in ("outline_zh", "title_zh"):
                continue
            if field_name in ManualConfig.RENAME_MAP:
                new_key = ManualConfig.RENAME_MAP[field_name]
            else:
                new_key = field_name
            assert new_key in CrawlerResultFields, f"Field {new_key} is not a valid CrawlerResultFields"
            new_key = cast(CrawlerResultFields, new_key)

            field_site = Config.parse_sites(d.get(f"{field_name}_website", []))
            if field_name in ("outline", "title"):
                field_site += Config.parse_sites(d.get(f"{field_name}_zh_website", []))
            if len(d.get("website_set", [])) > 0:
                field_site.insert(0, Website.OFFICIAL)
            field_site_exclude = Config.parse_sites(d.get(f"{field_name}_website_exclude", []))
            field_lang = Language(d.get(f"{field_name}_language", Language.UNDEFINED))
            field_translate: bool = d.get(f"{field_name}_translate", False)

            if field_name in none_fields:  # 不单独刮削
                field_configs[new_key] = FieldConfig(language=field_lang, translate=field_translate)
                continue
            if field_name in whole_fields:
                sites = list(dict.fromkeys(s for s in field_site + all_enabled_sites if s not in field_site_exclude))
            else:
                sites = list(dict.fromkeys(s for s in field_site if s not in field_site_exclude))
            field_configs[new_key] = FieldConfig(site_prority=sites, language=field_lang, translate=field_translate)
            # 处理旧版无配置项的字段
        field_configs[CrawlerResultFields.ALL_ACTORS] = field_configs.get(
            CrawlerResultFields.ACTORS,
            FieldConfig(site_prority=[Website.JAVDB], language=Language.JP),
        )
        field_configs[CrawlerResultFields.ORIGINALPLOT] = field_configs.get(
            CrawlerResultFields.OUTLINE,
            FieldConfig(site_prority=[Website.THEPORNDB, Website.DMM, Website.JAV321], language=Language.ZH_CN),
        )
        field_configs[CrawlerResultFields.ORIGINALTITLE] = field_configs.get(
            CrawlerResultFields.TITLE,
            FieldConfig(site_prority=[Website.THEPORNDB, Website.DMM, Website.JAV321], language=Language.ZH_CN),
        )
        d["field_configs"] = field_configs

    @field_validator("timed_interval", "rest_time", mode="before")
    def convert_time_str_to_timedelta(cls, v):
        if isinstance(v, timedelta):
            return v
        if isinstance(v, str) and re.match(r"^\d{2}:\d{2}:\d{2}$", v):
            h, m, s = map(int, v.split(":"))
            return timedelta(hours=h, minutes=m, seconds=s)
        return v

    @classmethod
    def from_legacy(cls, data: dict[str, Any]) -> "Config":
        """
        从 ConfigV1 创建 Config 实例. 此方法仅用于转换旧版配置文件.
        """
        # 应用兼容规则
        for rule in COMPAT_RULES:
            if isinstance(rule, Rename):
                if rule.old_name in data:
                    data[rule.new_name] = rule.to_new(data[rule.old_name]) if rule.to_new else data[rule.old_name]
                    data.pop(rule.old_name, None)
            elif isinstance(rule, Remove):
                data.pop(rule.name, None)

        # 处理 site_configs
        site_configs: dict[Website, SiteConfig] = {}
        for key, value in data.items():
            # custom url
            if key.endswith("_website") and key[:-8] in Website:
                site_name = key.replace("_website", "")
                site_configs[Website(site_name)] = SiteConfig(custom_url=value)
        data["site_configs"] = site_configs

        # 格式转换
        def handle_dict(model_fields: dict[str, FieldInfo], data: dict[str, Any]) -> dict[str, Any]:
            for name, info in model_fields.items():
                assert info.annotation is not None, f"Field {name} has no annotation"
                # 处理嵌套
                if issubclass(info.annotation, BaseModel):
                    sub_dict = handle_dict(info.annotation.model_fields, data)
                    data[name] = sub_dict
                    continue
                if name not in data:
                    continue
                if "list" in str(info.annotation) or "set" in str(info.annotation):
                    if name in (
                        "media_type",
                        "sub_type",
                        "clean_ext",
                        "clean_name",
                        "clean_contains",
                        "clean_ignore_ext",
                        "clean_ignore_contains",
                        "nfo_tag_actor_contains",
                    ):
                        data[name] = str_to_list(data[name], "|")
                    else:
                        data[name] = str_to_list(data[name], ",")
                if info.annotation is type(timedelta) and re.match(r"^\d{2}:\d{2}:\d{2}$", data[name]):
                    h, m, s = map(int, data[name].split(":"))
                    data[name] = timedelta(hours=h, minutes=m, seconds=s)
            return data

        data = handle_dict(cls.model_fields, data)
        cls.update(data)
        return cls.model_validate(data)

    @classmethod
    @lru_cache
    def ui_schema(cls) -> dict[str, Any]:
        return extract_ui_schema_recursive(cls.json_schema())

    @classmethod
    @lru_cache
    def json_schema(cls) -> dict[str, Any]:
        schema = cls.model_json_schema()
        _mark_dead_download_options(schema)
        return schema


@dataclass
class CompatRule:
    # 添加必要注释
    notes: list = field(kw_only=True, default_factory=list)


# 这 4 个「忽略有码/无码/FC2/国产」选项对应的封面跳过裁剪逻辑已删除, 勾选无任何效果;
# 在设置表单的下拉选项中隐藏, 但枚举成员保留, 旧配置里已勾选的值仍能正常解析和显示.
_DEAD_DOWNLOAD_OPTIONS = ("ignore_youma", "ignore_wuma", "ignore_fc2", "ignore_guochan")


def _mark_dead_download_options(schema: dict[str, Any]) -> None:
    """在 download_files 的 JSON Schema 中标记已失效的枚举选项, 由前端从可选列表中隐藏."""
    targets = [schema.get("$defs", {}).get("DownloadableFile", {})]
    items = schema.get("properties", {}).get("download_files", {}).get("items", {})
    if items:
        targets.append(items)
    for target in targets:
        if target.get("enum"):
            target["deprecated"] = list(_DEAD_DOWNLOAD_OPTIONS)


@dataclass
class Rename[TRaw = str, TNew = TRaw](CompatRule):
    old_name: str
    new_name: str
    to_new: Callable[[TRaw], TNew] | None = None
    to_old: Callable[[TNew], TRaw] | None = None


@dataclass
class Remove(CompatRule):
    name: str


# 描述 Config 相比于 ConfigV1 的变更并添加相应的兼容规则
COMPAT_RULES: list[CompatRule] = [
    Remove("version"),
    Remove("unknown_fields"),
    Rename[str, bool](
        "type",
        "use_proxy",
        to_new=lambda x: x != "no",
        to_old=lambda x: "no" if not x else "yes",
        notes=["ConfigV1.type", Config().use_proxy, "与关键词冲突"],
    ),
    Rename("outline_show", "outline_format", notes=["ConfigV1.outline_show", Config().outline_format, "澄清语义"]),
    Rename("tag_include", "nfo_tag_include", notes=["ConfigV1.tag_include", Config().nfo_tag_include, "澄清语义"]),
    Remove("show_4k", notes=["ConfigV1.show_4k", "功能与命名模板冲突"]),
    Remove("show_moword", notes=["ConfigV1.show_moword", "功能与命名模板冲突"]),
]
if TYPE_CHECKING:
    from .v1 import ConfigV1

    # 方便快速查看 ConfigV1 的字段
    _ = [
        ConfigV1.type,
        ConfigV1.outline_show,
        ConfigV1.tag_include,
        ConfigV1.show_4k,
        ConfigV1.show_moword,
    ]
