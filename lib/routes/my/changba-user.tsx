import { load } from 'cheerio';
import { renderToString } from 'hono/jsx/dom/server';
import CryptoJS from 'crypto-js';

import type { Route } from '@/types';
import { ViewType } from '@/types';
import cache from '@/utils/cache';
import got from '@/utils/got';
import { PRESETS } from '@/utils/header-generator';

export const route: Route = {
    path: '/changba/user/:userid',
    categories: ['social-media'],
    view: ViewType.Audios,
    example: '/my/changba/user/skp6hhF59n48R-UpqO3izw',
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

// 解密函数
function decryptWorkPath(encryptedStr: string) {
    const AES_KEY_RAW = 'a17fe74e421c2cbf3dc323f4b4f3a1af';
    try {
        const iv = CryptoJS.enc.Utf8.parse(AES_KEY_RAW.substring(0, 16));
        const key = CryptoJS.enc.Utf8.parse(AES_KEY_RAW.substring(16));
        const decrypted = CryptoJS.AES.decrypt(encryptedStr, key, {
            iv,
            padding: CryptoJS.pad.Pkcs7,
            mode: CryptoJS.mode.CBC,
        });
        return decrypted.toString(CryptoJS.enc.Utf8);
    } catch (e) {
        return null;
    }
}

async function handler(ctx) {
    const userid = ctx.req.param('userid');
    const url = `https://changba.com/wap/index.php?s=${userid}`;
    
    const response = await got({
        method: 'get',
        url,
        headerGeneratorOptions: PRESETS.MODERN_IOS,
    });

    const $ = load(response.data);
    const author = $('.user-main-info .uname').text().trim() || '唱吧用户';
    const authorimg = $('.user-main-info .poster img').attr('data-src');
    const list = $('.user-work .work-info').toArray();

    let items = await Promise.all(
        list.map((item) => {
            const el = $(item);
            const link = el.attr('href') || el.find('a').attr('href');
            
            if (!link) return null;

            return cache.tryGet(link, async () => {
                const result = await got({
                    method: 'get',
                    url: link,
                    headerGeneratorOptions: PRESETS.MODERN_IOS,
                });

                const html = result.data;
                // 匹配加密的路径变量
                const encMatch = html.match(/enc_workpath\s*[:=]\s*['"]([^'"]+)['"]/) || 
                               html.match(/commonObj\.url\s*=\s*'([^']+)'/);
                
                if (!encMatch) return null;

                let realUrl = decryptWorkPath(encMatch[1]);
                if (!realUrl) return null;

                // 规范化 URL 协议
                if (realUrl.startsWith('//')) {
                    realUrl = 'https:' + realUrl;
                } else if (!realUrl.startsWith('http')) {
                    realUrl = 'https://' + realUrl;
                }
                // 统一强制使用 https 防止部分阅读器拦截
                realUrl = realUrl.replace('http://', 'https://');

                const $item = load(html);
                const desc = $item('.des, .song-des').text().trim();
                const title = $item('.work-title, .work-name, .song-name').first().text().trim() || '无题';
                
                // 提取封面图
                const coverStyle = $item('.work-cover').attr('style') || '';
                const coverMatch = coverStyle.match(/url\(['"]?(.*?)['"]?\)/);
                const itunes_item_image = coverMatch ? coverMatch[1] : '';

                return {
                    title,
                    description: renderToString(<ChangbaWorkDescription desc={desc} mp3url={realUrl} />),
                    link,
                    author,
                    itunes_item_image,
                    enclosure_url: realUrl,
                    enclosure_type: realUrl.includes('.mp4') ? 'video/mp4' : 'audio/mpeg',
                };
            });
        })
    );

    items = items.filter(Boolean);

    return {
        title: `${author} - 唱吧`,
        link: url,
        description: $('meta[name="description"]').attr('content') || `${author} 的唱吧主页`,
        item: items,
        image: authorimg,
        itunes_author: author,
        itunes_category: 'Music',
    };
}

const ChangbaWorkDescription = ({ desc, mp3url }: { desc: string; mp3url: string }) => (
    <>
        <p>{desc}</p>
        <audio controls src={mp3url} preload="metadata" style={{ width: '100%' }}></audio>
    </>
);