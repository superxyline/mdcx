"""临时脚本: 验证候选厂牌官网是否为 official 爬虫支持的统一模板.

判断依据: 搜索页能返回 a.img.hover 结果结构, 详情页含 p-workPage__title 特征类名.
"""

import asyncio

from lxml import etree

from mdcx.server import var

var.is_server = True
from mdcx.server.signals import signal  # noqa: E402
from mdcx.signals import set_signal  # noqa: E402

set_signal(signal)

from mdcx.config.manager import manager  # noqa: E402
from mdcx.crawlers import official  # noqa: E402
from mdcx.utils import executor  # noqa: E402

# 候选: (官网, 测试番号)
CANDIDATES = [
    ("https://www.sod.co.jp", "STARS-001"),
    ("https://maxing.jp", "MXGS-1001"),
    ("https://www.tma.co.jp", "T28-618"),
    ("https://centervillage.net", "CESD-552"),
    ("https://naturalhigh.jp", "NACR-745"),
    ("https://nagae-style.co.jp", "PFES-090"),
    ("https://gqdow.com", "GQD-017"),
    ("https://realworks22.com", "XRW-980"),
    ("https://www.hmpworks.com", "HJBB-199"),
]


async def test_one(client, site, number):
    url = f"{site}/search/list?keyword={number.replace('-', '')}"
    html, err = await client.get_text(url)
    if not html:
        return f"{site:35s} 请求失败: {str(err)[:60]}"
    t = etree.fromstring(html, etree.HTMLParser())
    hits = t.xpath('//a[@class="img hover"]')
    real_url, poster = official.get_real_url(t, number)
    detail_ok = ""
    if real_url:
        dhtml, _ = await client.get_text(real_url)
        if dhtml:
            detail_ok = f" 模板title={'Y' if 'p-workPage__title' in dhtml else 'N'}"
    return f"{site:35s} 搜索条目={len(hits):2d} 命中={'Y' if real_url else 'N'}{detail_ok}"


async def main():
    client = manager.computed.async_client
    tasks = [test_one(client, s, n) for s, n in CANDIDATES]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    for r in results:
        print(r if isinstance(r, str) else f"异常: {r}")


if __name__ == "__main__":
    executor.run(main())
