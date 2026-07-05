import querystring from 'node:querystring';

import { load } from 'cheerio';

import { config } from '@/config';
import type { Route } from '@/types';
import cache from '@/utils/cache';
import got from '@/utils/got';

const typeMap = {
    wish: '想看',
    do: '在看',
    collect: '看过',
};

export const route: Route = {
    // 将路径改为通用格式，支持 :type 参数
    path: '/douban/people/:userid/:type/:routeParams?',
    categories: ['social-media'],
    example: '/my/douban/people/150983840/wish',
    parameters: {
        userid: '用户id',
        type: '状态：wish(想看), do(在看), collect(看过)',
        routeParams: '额外参数；见下',
    },
    features: {
        requireConfig: false,
        requirePuppeteer: false,
        antiCrawler: false,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
    },
    name: '用户电影记录',
    maintainers: ['exherb'],
    handler,
    description: `对应豆瓣用户的想看 (wish)、在看 (do) 和看过 (collect)。`,
};

async function handler(ctx) {
    const userid = ctx.req.param('userid');
    const type = ctx.req.param('type') || 'wish'; // 默认 wish
    const typeText = typeMap[type] || '记录';
    const routeParams = querystring.parse(ctx.req.param('routeParams'));

    let userName;

    const pageSize = 15;
    const pagesCount = routeParams.pagesCount ? Number.parseInt(routeParams.pagesCount) : 1;
    const tasks = [];
    for (let page = 0; page < pagesCount; page += 1) {
        // 动态构造 URL
        const url = `https://movie.douban.com/people/${userid}/${type}?start=${page * pageSize}`;

        tasks.push(
            cache
                .tryGet(
                    url,
                    async () => {
                        const _r = await got({
                            method: 'GET',
                            url,
                            headers: {
                                Referer: url,
                                Cookie: config.douban.cookie || '',
                            },
                        });
                        return _r.data;
                    },
                    config.cache.routeExpire,
                    false
                )
                .then((data) => {
                    const $ = load(data);
                    const list = $('div.article > div.grid-view > div.item');
                    userName = userName || $('div.side-info-txt > h3').text().trim();

                    if (list) {
                        return Promise.all(
                            list.toArray().map((item) => {
                                const $item = $(item);
                                const itemPicUrl = $item.find('.pic a img').attr('src');
                                const info = $item.find('.info');
                                const rawTitle = info.find('ul li.title a').text().trim();
                                const itemUrl = info.find('ul li.title a').attr('href');
                                // 提取主标题
                                const titleName = rawTitle
                                    .split('/')
                                    .map((t) => t.trim())
                                    .filter(Boolean)[0];
                                const day = info.find('ul li .date').text().trim();
                                const intro = info.find('.intro').text().trim();

                                return {
                                    // 需求1：在标题前缀加上状态
                                    title: `[${typeText}] ${titleName}`,
                                    // 需求2：在内容底部加上状态说明，并优化 Telegram 图片显示
                                    description: `${intro}<br><br><b>状态：</b>${typeText}<br><b>日期：</b>${day}<br><br><img src="${itemPicUrl}">`,
                                    link: itemUrl,
                                    pubDate: day ? new Date(day) : new Date(),
                                    author: userName,
                                };
                            })
                        );
                    }
                })
        );
    }

    const items = (await Promise.all(tasks)).flat();
    return {
        title: `豆瓣${typeText} - ${userName || userid}`,
        link: `https://movie.douban.com/people/${userid}/${type}`,
        item: items,
    };
}
