## 新增

*

## 修复

* javdb 刮削失败
* 文件选择器新增「位置」根目录切换: 新增 `GET /api/v1/files/roots` 返回白名单全部根目录(含飞牛授权目录合并结果), 选择器顶部一键跳转; 此前只能从首个根目录(`/media`)开始翻, 无法发现其他已授权目录(如 /vol1、/vol2 下的授权文件夹)
* 设置页新增「影视库去重」分区: 影视库目录配置项原先未归类, 被埋进「高级选项 → 杂项」, 用户在常用设置里找不到; 现在与刮削源媒体路径并列显示, 去重页与接口提示的跳转路径也一并更正

<details>
<summary>Full Changelog</summary>

b6887b7 fix: _detail 返回值为空
1cf11f0 chore: remove fixture tmpdir

</details>
