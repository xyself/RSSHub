import { Buffer } from 'buffer';

// 模拟你从 got 获取到的网页 HTML 片段（包含 commonObj 变量）
const mockHtmlResponse = `
    <html>
        <script>
            var commonObj = {
                "data": {
                    "workpath": "91877d91993b69ac78892166e95375db.mp3",
                    "enc_workpath": "MTYzOTY4OTIzXzE3MTI3NDI0OTIubXAz",
                    "sign": "bfdbdd1cdcb110a9662d34967eb04305",
                    "t": "69ce68f0",
                    "is_video": 0
                }
            };
        </script>
    </html>
`;

/**
 * 核心逻辑：从 HTML 字符串中提取并生成地址
 */
function getUrlFromHtml(html) {
    // 1. 使用正则匹配 var commonObj = { ... }; 这一段 JSON
    // 这是最关键的一步，取代了硬编码
    const match = html.match(/var commonObj\s*=\s*({.*?});/s);
    
    if (!match) return "错误：未能在页面中找到 commonObj 数据";

    try {
        // 2. 解析 JSON
        const commonObj = JSON.parse(match[1]);
        const info = commonObj.data;

        // 3. 动态获取字段（不再硬编码）
        let fileName = info.workpath || "";
        const sign = info.sign || "";
        const t = info.t || "";
        const isVideo = info.is_video === 1;

        if (!fileName) return "错误：JSON 中缺少 workpath 字段";

        // 4. 拼接
        const host = isVideo ? 'https://aliimg.changba.com' : 'https://qiniuuwmp3.changba.com';
        return `${host}/${fileName}?sign=${sign}&t=${t}`;

    } catch (e) {
        return "解析 JSON 出错: " + e.message;
    }
}

// --- 运行测试 ---
console.log("---------------------------------------");
console.log("【实时提取测试结果】:");
console.log(getUrlFromHtml(mockHtmlResponse));
console.log("---------------------------------------");