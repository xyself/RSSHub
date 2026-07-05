import { renderToString } from 'hono/jsx/dom/server';
import got from '@/utils/got';
import crypto from 'crypto';

import { config } from '@/config';
import cache from '@/utils/cache';
import type { Route } from '@/types';

// ===== 加密 =====
const aesEncrypt = (secKey: string, text: string) => {
    const cipher = crypto.createCipheriv('AES-128-CBC', secKey, '0102030405060708');
    return cipher.update(text, 'utf-8', 'base64') + cipher.final('base64');
};

const aesRsaEncrypt = (text: string) => ({
    params: aesEncrypt('TA3YiYCfY2dDJQgg', aesEncrypt('0CoJUm6Qyw8W8jud', text)),
    encSecKey:
        '84ca47bca10bad09a6b04c5c927ef077d9b9f1e37098aa3eac6ea70eb59df0aa28b691b7e75e4f1f9831754919ea784c8f74fbfadf2898b0be17849fd656060162857830e241aba44991601f137624094c114ea8d17bce815b0cd4e5b8e2fbaba978c6d1d14dc3d1faf852bdd28818031ccdaaa13a6018e1024e2aae98844210',
});

// ===== 请求 =====
async function fetchPlayRecord(uid: string, type: number, cookie?: string) {
    const { data } = await got.post(
        'https://music.163.com/weapi/v1/play/record?csrf_token=',
        {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Referer: 'https://music.163.com/',
                'User-Agent': 'Mozilla/5.0',
                ...(cookie && { Cookie: cookie }),
            },
            body: new URLSearchParams(
                aesRsaEncrypt(
                    JSON.stringify({
                        uid,
                        type,
                    })
                )
            ).toString(),
        }
    );

    return data;
}

// ===== 渲染 =====
const renderDescription = (record, song, index) =>
    renderToString(
        <div>
            排行：{index + 1} 播放次数：{record.playCount} 得分：{record.score}
            <br />
            歌曲：
            <a href={`http://music.163.com/song?id=${song.id}`}>{song.name}</a>
            <br />
            歌手：
            {song.ar?.map((artist, i) => (
                <>
                    <a href={`https://music.163.com/artist?id=${artist.id}`}>{artist.name}</a>
                    {i < song.ar.length - 1 ? ' / ' : null}
                </>
            ))}
            <br />
            {song.al?.picUrl ? (
                <>
                    歌曲图：
                    <img src={song.al.picUrl} />
                    <br />
                </>
            ) : null}
        </div>
    );

function getItem(records) {
    if (!records?.length) {
        return [{ title: '暂无听歌排行' }];
    }

    return records.map((record, index) => {
        const song = record.song;
        if (!song) return null;

        const artists = song.ar?.map((a) => a.name).join('/') ?? '未知歌手';

        return {
            title: `[${index + 1}] ${song.name} - ${artists}`,
            link: `http://music.163.com/song?id=${song.id}`,
            author: artists,
            description: renderDescription(record, song, index),
        };
    }).filter(Boolean);
}

// ===== 路由 =====
export const route: Route = {
    path: '/163/music/user/playrecords/:uid/:type?',
    categories: ['multimedia'],
    example: '/my/163/music/user/playrecords/45441555/1',
    parameters: {
        uid: '用户 uid',
        type: '0 所有时间 / 1 最近一周',
    },
    features: {
        requireConfig: [
            {
                name: 'NCM_COOKIES',
                optional: false, // ❗建议强制
                description: '网易云 cookie（强烈建议填写，否则可能无数据）',
            },
        ],
    },
    name: '用户听歌排行（weapi）',
    maintainers: ['you'],
    handler,
};

// ===== handler =====
async function handler(ctx) {
    const uid = ctx.req.param('uid');
    const type = Number.parseInt(ctx.req.param('type')) || 0;

    const cacheKey = `ncm:playrecord:${uid}:${type}`;

    const data = await cache.tryGet(cacheKey, async () => {
        return await fetchPlayRecord(uid, type, config.ncm.cookies);
    }, 60 * 5); // 5分钟缓存

    const recordsRaw = type === 1 ? data.weekData : data.allData;
    const records = recordsRaw?.filter((r) => r?.song) ?? [];

    return {
        title: `${type === 1 ? '听歌榜单（最近一周）' : '听歌榜单（所有时间）'} - ${uid}`,
        link: `https://music.163.com/user/home?id=${uid}`,
        item: getItem(records),
    };
}