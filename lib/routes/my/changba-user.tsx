import { load } from 'cheerio';
import CryptoJS from 'crypto-js';
import type { Context } from 'hono';
import { renderToString } from 'hono/jsx/dom/server';

import type { DataItem, Route } from '@/types';
import { ViewType } from '@/types';
import cache from '@/utils/cache';
import got from '@/utils/got';
import { PRESETS } from '@/utils/header-generator';
import { parseDate } from '@/utils/parse-date';

export const route: Route = {
    path: '/changba-user/:userid',
    categories: ['social-media'],
    view: ViewType.Audios,
    example: '/my/changba-user/skp6hhF59n48R-UpqO3izw',
    parameters: { userid: '用户ID, 可在对应分享页面的 URL 中找到' },
    features: {
        requireConfig: false,
        requirePuppeteer: false,
        antiCrawler: false,
        supportBT: false,
        supportPodcast: true,
        supportScihub: false,
    },
    radar: [
        {
            source: ['changba.com/s/:userid'],
        },
    ],
    name: '唱吧用户作品',
    maintainers: ['kt286', 'xizeyoupan', 'pseudoyu'],
    handler,
};

const DEFAULT_JS_SECRET = 'wrjAzPfl';

// 解密函数 — 用 jsSecret 的 MD5 派生 key/iv
function decryptWorkPath(encryptedStr: string, jsSecret: string = DEFAULT_JS_SECRET) {
    try {
        const n = CryptoJS.MD5(jsSecret).toString();
        const iv = CryptoJS.enc.Utf8.parse(n.slice(0, 16));
        const key = CryptoJS.enc.Utf8.parse(n.slice(16));
        return (
            CryptoJS.AES.decrypt(encryptedStr, key, {
                iv,
                padding: CryptoJS.pad.Pkcs7,
                mode: CryptoJS.mode.CBC,
            }).toString(CryptoJS.enc.Utf8) || null
        );
    } catch {
        return null;
    }
}

// 规范化 URL 协议为 https
function normalizeUrl(url: string) {
    if (url.startsWith('//')) {
        return 'https:' + url;
    }
    return url.replace(/^http:\/\//, 'https://');
}

// 格式化为北京时间戳: (yyyy.mm.dd-hh.mm.ss)
function formatToChinaTimeTag(gmtStr: string | null | undefined) {
    try {
        const date = gmtStr ? new Date(gmtStr) : new Date();
        const chinaTime = new Date(date.getTime() + 8 * 3600 * 1000);
        const y = chinaTime.getUTCFullYear();
        const m = String(chinaTime.getUTCMonth() + 1).padStart(2, '0');
        const d = String(chinaTime.getUTCDate()).padStart(2, '0');
        const hh = String(chinaTime.getUTCHours()).padStart(2, '0');
        const mm = String(chinaTime.getUTCMinutes()).padStart(2, '0');
        const ss = String(chinaTime.getUTCSeconds()).padStart(2, '0');
        return `(${y}.${m}.${d}-${hh}.${mm}.${ss})`;
    } catch {
        return '';
    }
}

async function handler(ctx: Context) {
    const userid = ctx.req.param('userid');
    const listUrl = `https://changba.com/wap/index.php?s=${userid}`;

    const response = await got({
        method: 'get',
        url: listUrl,
        headerGeneratorOptions: PRESETS.MODERN_IOS,
    });

    const $ = load(response.data);
    // 取第一个 text node 避免子元素干扰
    const authorEl = $('.user-main-info .uname');
    const author = authorEl.contents().first().text().trim() || authorEl.text().trim() || '唱吧用户';
    const authorimg = $('.user-main-info .poster img').attr('data-src');
    const list = $('a.work-info[href]').toArray();

    const items: Array<DataItem | null> = await Promise.all(
        list.map((item) => {
            const el = $(item);
            const href = el.attr('href')!;
            const enidMatch = href.match(/\/s\/([\w-]+)/);
            if (!enidMatch) {
                return null;
            }
            const enid = enidMatch[1];
            const link = `https://changba.com/s/${enid}`;

            const coverStyle = el.find('.work-cover').attr('style') || '';
            const coverMatch = coverStyle.match(/url\(['"]?(.*?)['"]?\)/);
            const listCover = coverMatch?.[1] ?? '';

            // @ts-ignore cache.tryGet 泛型支持
            return cache.tryGet(link, async () => {
                const apiRes = await got({
                    method: 'post',
                    url: 'https://changba.com/redirect_song_main.php',
                    form: { enc_workid: enid, is_mobile: '1' },
                    headerGeneratorOptions: PRESETS.MODERN_IOS,
                    headers: {
                        Referer: link,
                        Origin: 'https://changba.com',
                    },
                });

                const data = apiRes.data as {
                    code: number;
                    data?: {
                        jsSecret?: string;
                        userwork?: {
                            enc_workpath?: string;
                            song?: { name?: string };
                            user?: { headphoto?: string; nickname?: string };
                        };
                    };
                };

                if (data.code !== 0 || !data.data?.userwork) {
                    return null;
                }

                const userwork = data.data.userwork;
                const encWorkpath = userwork.enc_workpath;
                if (!encWorkpath) {
                    return null;
                }

                const jsSecret = data.data.jsSecret || DEFAULT_JS_SECRET;
                let realUrl = decryptWorkPath(encWorkpath, jsSecret);
                if (!realUrl) {
                    return null;
                }
                realUrl = normalizeUrl(realUrl);

                // 获取音频文件的 Last-Modified 确定上传时间
                let pubDate: Date | undefined;
                let timeTag = '';
                try {
                    const headRes = await got({
                        method: 'head',
                        url: realUrl,
                        headerGeneratorOptions: PRESETS.MODERN_IOS,
                    });
                    const lastModified = headRes.headers['last-modified'];
                    if (lastModified) {
                        pubDate = parseDate(lastModified);
                        timeTag = formatToChinaTimeTag(lastModified);
                    }
                } catch {
                    // Ignore HEAD request failure
                }

                const songName = userwork.song?.name || el.find('.work-title').text().trim() || '无题';
                const itemAuthor = userwork.user?.nickname || author;
                const itunes_item_image = listCover || userwork.user?.headphoto || '';

                // 标题添加时间戳前缀，如: (2026.08.04-13.44.04)我是秋闲 - 再见蒲公英
                const title = timeTag ? `${timeTag}${itemAuthor} - ${songName}` : `${itemAuthor} - ${songName}`;

                return {
                    title,
                    description: renderToString(<ChangbaWorkDescription mp3url={realUrl} />),
                    link,
                    author: itemAuthor,
                    pubDate,
                    itunes_item_image,
                    enclosure_url: realUrl,
                    enclosure_type: realUrl.includes('.mp4') ? 'video/mp4' : 'audio/mpeg',
                };
            }) as unknown as Promise<DataItem | null>;
        })
    );

    const filteredItems = items.filter((x): x is DataItem => x !== null);

    return {
        title: `${author} - 唱吧`,
        link: listUrl,
        description: $('meta[name="description"]').attr('content') || `${author} 的唱吧主页`,
        item: filteredItems,
        image: authorimg,
        itunes_author: author,
        itunes_category: 'Music',
    };
}

const ChangbaWorkDescription = ({ mp3url }: { mp3url: string }) => <audio controls src={mp3url} preload="metadata" style={{ width: '100%' }}></audio>;
