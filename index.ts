import * as puppeteer from 'puppeteer';
import * as readline from 'readline';
import * as fs from 'fs';
import * as jimp from 'jimp';
import * as qrcode from 'qrcode-terminal';
import * as colors from 'colors';
import { setInterval, clearTimeout } from 'timers';
import * as cursor from 'term-cursor';

const SEL_QR = 'img';
const SEL_CHATLIST = ".chatlist-panel-body";
const SEL_PEOPLE = '.chat-title > span';
const SEL_MSG = 'div.msg';
const SEL_IN_MESSAGE = 'div.message-in span.emojitext';
const SEL_OUT_MESSAGE = 'div.message-out span.emojitext';
const SEL_MSG_INPUT = 'div.pluggable-input-body';
const SEL_BUTTON_SEND = 'button.compose-btn-send';

const LAST_N_MESSAGES = 10;

const URL = 'https://web.whatsapp.com';
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/60.0.3112.78 Safari/537.36";

const NORMAL_COLOUR = "cyan";
const OUT_MSG_COLOUR = "red";
const ERROR_COLOUR = "bgRed";

let messageScanner;

let clip = "";

const stdout = process.stdout;
const stdin = process.stdin;
stdin.setRawMode(true);
stdin.resume();
stdin.setEncoding('utf8');

console.log = (text, split) => {
    text = (text || "").toString();
    const doLog = t => {
        readline.clearLine(stdout, 0);
        stdout.write("\n");
        cursor.up(1);
        stdout.write(t);
        readline.cursorTo(stdout, 0);
        cursor.down(1);
    };
    if (split) {
        text.match(new RegExp(`.{1,${stdout.columns - 2}}`, "g")).forEach(doLog);
    } else {
        doLog(text);
    }
    if (clip) {
        stdout.write(`> ${clip}`);
    }
};
(() => {
    const err = console.error;
    console.error = text => err(colors[ERROR_COLOUR](text));
})();

const cleanUpAndQuit = browser => {
    let closing = false;
    return async () => {
        console.log(colors[NORMAL_COLOUR]("\nShutting down...\n\n"));
        if (!closing) {
            closing = true;
            if (messageScanner) clearTimeout(messageScanner);
            try { await browser.close(); } catch (e) { }
        }
        process.exit();
    }
};

const printQRcode = async page => {
    const qrFile = "qr.png";
    const qrDecoder = new (require('qrcode-reader'))();
    while (true) {
        try {
            await page.waitFor(SEL_QR, { timeout: 60000 });
            await (await page.$(SEL_QR)).screenshot({ path: qrFile });
            qrDecoder.callback = function (error, result) {
                if (error) throw error;
                stdout.write('\n\n');
                qrcode.generate(result.result);
                stdout.write('\n\n');
            }
            qrDecoder.decode((await jimp.read(fs.readFileSync(qrFile))).bitmap);
            break;
        } catch (e) {
            console.error(`Error: ${JSON.stringify(e)}\nRetrying..."`);
            await page.reload();
        }
    }
    fs.unlink(qrFile, err => console.error(err || ""));
};

(async () => {
    const browser = await puppeteer.launch({
        headless: process.argv[2] != 's',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    process.on("SIGINT", cleanUpAndQuit(browser));

    const readAnswer = (() => {
        let processor = null;
        return x => {
            if (typeof x == 'function') {
                stdout.write('> ');
                processor = x;
            } else if (typeof processor == 'function') {
                const rtn = processor(x);
                if (typeof rtn == 'function') {
                    processor = rtn;
                }
            }
        }
    })();

    stdin.on('data', function (key) {
        const keyCode = key.charCodeAt(0);
        // ctrl-c ( end of text )
        if (key === '\u0003') {
            cleanUpAndQuit(browser)();
        }
        if (/^[a-zA-Z0-9 `¬¦!"£\$%^\&\*\(\)_\+-=\[\]\{\};:'@#~,<\.>\/?\\|\r\n]*$/g.test(key)) {
            stdout.write(key == "\r" ? "\n" : key);
            if (key == "\r") {
                readAnswer(clip);
                clip = "";
            } else {
                clip += key
            }
        } else if (keyCode == 8 && clip) {
            const linesToDel = Math.ceil(clip.length / (stdout.columns - 2));
            for (let i = 0; i < linesToDel; i++) {
                readline.clearLine(stdout, 0);
                cursor.up(1);
            }
            cursor.down(1);
            readline.cursorTo(stdout, 0);
            stdout.write(`> ${clip = clip.split("").reverse().slice(1).reverse().join("")}`);
        }
    });

    try {
        const page = await browser.newPage();

        page.setUserAgent(USER_AGENT);

        console.log(colors[NORMAL_COLOUR]("Loading..."));
        await page.goto(URL);

        await printQRcode(page);
        console.log(colors[NORMAL_COLOUR]("Scan QR code with WhatsApp on your phone to log in"));

        await page.waitFor(SEL_CHATLIST, { timeout: 60000 });
        console.log(colors[NORMAL_COLOUR]("Log in success!"));

        const people = await page.$$(SEL_PEOPLE);

        const printPeople = async () => {
            for (let i = 0; i < people.length; i++) {
                console.log(colors[NORMAL_COLOUR](`${i + 1} - ${await (await people[i].getProperty('textContent')).jsonValue()}`));
            }
        };

        await printPeople();

        console.log(colors[NORMAL_COLOUR]("Who would you like to chat to?"));
        readAnswer(async (answer) => {
            let lastMessage;
            const printMessage = async msg => {
                const inMsg = await msg.$(SEL_IN_MESSAGE);
                const outMsg = await msg.$(SEL_OUT_MESSAGE);
                const theMessage = (inMsg || outMsg);
                if (theMessage) {
                    const msgText = await (await theMessage.getProperty('textContent')).jsonValue();
                    if (outMsg) {
                        console.log(`> ${msgText}`, true);
                    } else {
                        console.log(colors[OUT_MSG_COLOUR](`> ${lastMessage = msgText}`), true);
                    }
                }
            };
            people[parseInt(answer) - 1].click();
            await page.waitFor(SEL_MSG, { timeout: 60000 });
            const msgs = (await page.$$(SEL_MSG)).slice(-LAST_N_MESSAGES);
            for (const msg of msgs) {
                await printMessage(msg);
            }
            messageScanner = setInterval(async () => {
                const msg = (await page.$$(SEL_IN_MESSAGE)).slice(-1)[0];
                if (msg) {
                    const msgContent = await (await msg.getProperty('textContent')).jsonValue();
                    if (lastMessage && lastMessage != msgContent) {
                        console.log(colors[OUT_MSG_COLOUR](`> ${msgContent}`), true);
                    }
                    lastMessage = msgContent;
                }
            }, 200);
            const readInput = () => readAnswer(async (line: string) => {
                if (line.trim()) {
                    await (await page.$(SEL_MSG_INPUT)).type(line);
                    await page.waitFor(SEL_BUTTON_SEND, { timeout: 60000 });
                    (await page.$(SEL_BUTTON_SEND)).click();
                }
                readInput();
            });
            readInput();
        });
    } catch (e) {
        console.error(JSON.stringify(e));
        console.trace();
        cleanUpAndQuit(browser)();
    }
})();