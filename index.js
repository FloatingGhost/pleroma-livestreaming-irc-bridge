const ircdkit = require('ircdkit');
const WebSocket = require('ws');
const { escape } = require('html-escaper');

const irc = ircdkit({
    maxNickLength: 20,
    hostname: 'movies-are-nice'
});

let sockets = {};
let channels = {};
 
const userJoin = (channel, username) => {
    console.log(username, 'joined', channel);
    if (!channels[channel].includes(username)) {
        channels[channel].push(username);
    }
};

const userLeave = (channel, username) => {
    channels[channel] = channels[channel].filter(x => x !== username);
};

const socketAddr = (connection, channel) => (
    `${connection.nickname}-${channel}`
);

const remoteUserMask = (connection, username) => (
    connection.mask.replace(new RegExp(connection.nickname, 'g'), username)
);

const sendNames = (connection, channel) => {
    console.log('NAMES FOR', channel);
    let names;
    if (channel) {
        names = channels[channel];
    } else {
        names = Object.values(sockets).flat();
    }
    connection.send(true, '353', connection.nickname, '@', channel, `:${names.join(' ')}`);
    connection.send(true, '366', connection.nickname, channel, ':End of /NAMES list.');
};

const setUpWebsocket = (socket, connection, channel) => {
    console.log(connection.nickname);
    const ping = setInterval(() => socket.send(JSON.stringify({Type: 2, Message: ''})), 1000);
    socket.ping = ping;

    socket.on('error', (e) => {
        console.log(e);
        connection.send(true, 'could not connect to websocket...');
    });

    socket.on('open', () => {
        socket.send(JSON.stringify({
            Type: 6,
            Message: JSON.stringify({
                Name: connection.nickname,
                Color: '#ffffff'
            })
        }));

        socket.send(JSON.stringify({
            Type: 1,
            Message: ''
        }));

        socket.on('message', (msg) => {
            let mask;
            const { Type: type, Data: data } = JSON.parse(msg);
            console.log(`Received message ${type}, ${JSON.stringify(data)}`);
            switch (type) {
            case 1:
                if (!connection.mask.includes(`${data.From}!`)) {
                    const mask = remoteUserMask(connection, data.From);
                    connection.send(mask, 'PRIVMSG', channel, `:${escape(data.Message)}`);
                } else {
                    connection.send(true, 'PRIVMSG', channel, `:${data.Message}`);
                }
                break;
            case 2:
                if (data.Command == 0) {
                    connection.send(true, 'TOPIC', channel, data.Arguments[0]);
                }
                break;
            case 3:
                mask = remoteUserMask(connection, data.User);
                switch (data.Event) {
                case 0: 
                    userJoin(channel, data.User);
                    connection.send(mask, 'JOIN', channel);
                    break;
                case 1:
                    userLeave(channel, data.User);
                    connection.send(mask, 'PART', channel);
                    break;
                case 5:
                    //eslint-disable-next-line
                    let [oldNick, newNick] = data.User.split(':');
                    mask = remoteUserMask(connection, oldNick);
                    connection.send(mask, 'NICK', newNick);
                }
                break;
            case 5:
                switch (data.Type) {
                case 1: 
                    data.Data.forEach(u => userJoin(channel, u));
                    sendNames(connection, channel);
                    break;
                case 7:
                    connection.send(true, data.Data);
                }
                break;
            case 7:
                break; 
            }
        });
    });
};

irc.listen(6667, function () {
    console.log('Server is listening for connections on port 6667');
});
 
irc.on('connection', function (connection) {
    connection.on('authenticated', () => {
        console.log(connection.nickname + ' has logged in on connection ' + connection.id);
    });
 
    connection.on('user:quit', () => {
        console.log(connection.mask + ' has disconnected.');
        Object.keys(sockets).filter(s => s.startsWith(connection.nickname)).forEach(channel => {
            const socket = sockets[channel];
            socket.close();
            clearInterval(socket.ping);
            delete sockets[channel];
        });
    });

    connection.on('JOIN', function (target) {
        const channel = target.replace('#', '');
        sockets[socketAddr(connection, target)] = new WebSocket(`${process.env.BASE_URL}/channels/${channel}/ws`);
        setUpWebsocket(sockets[socketAddr(connection, target)], connection, target);
        if (!channels[target]) {
            channels[target] = [];
        }
        console.log(target);
    });

    connection.on('PRIVMSG', (target, msg)  => {
        sockets[socketAddr(connection, target)].send(
            JSON.stringify({
                Type: 0,
                Message: msg
            })
        );
    });

    connection.on('NAMES', (target) => {
        sendNames(connection, target);        
    });

    connection.on('PING', (target) => {
        connection.send('PONG', target);
    });

    connection.on('PART', (target) => {
        if (target) {
            const socket = sockets[socketAddr(connection, target)];
            socket.close();
            delete sockets[socketAddr(connection, target)];
            connection.send('PART', target);
        }
    });

    connection.on('NICK', (target) => {
        Object.keys(sockets).filter(s => s.startsWith(connection.nickname)).forEach(  channel => {
            const socket = sockets[channel];
            socket.send(JSON.stringify({
                Type: 0,
                Message: `/nick ${target}`
            }));
            connection.nickname = target;
        });
    });

    connection.on('error', (err) => {
        console.error(err);
    });
});
