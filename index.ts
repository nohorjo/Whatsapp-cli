import * as puppeteer from 'puppeteer';
import * as readline from 'readline';
import * as fs from 'fs';
import * as jimp from 'jimp';
import * as qrcode from 'qrcode-terminal';
import * as colors from 'colors';
import { setInterval, clearTimeout } from 'timers';
import * as cursor from 'term-cursor';


const SEL_QR = 'img';
const SEL_CHATLIST = "#pane-side";
const SEL_PEOPLE = '#pane-side span[title][dir="auto"]';
const SEL_MSG = 'div.msg';
const SEL_IN_MESSAGE = 'div.message-in span.selectable-text.invisible-space.copyable-text';
const SEL_OUT_MESSAGE = 'div.message-out span.selectable-text.invisible-space.copyable-text';
const SEL_MSG_INPUT = 'footer>div>div>div';
const SEL_BUTTON_SEND = 'span[data-icon="send"]';

let clip = "";

const { stdout, stdin } = process;
(title => stdout.write(String.fromCharCode(27) + "]0;" + title + String.fromCharCode(7)))('wa-cli');
stdin.setRawMode(true);
stdin.resume();
stdin.setEncoding('utf8');

const { log, messageIn, messageOut, error } = (() => {
    const print = text => {
        text = (text || "").toString();
        text.match(new RegExp(`.{1,${stdout.columns - 2}}`, "g")).forEach(t => {
            readline.clearLine(stdout, 0);
            stdout.write("\n");
            cursor.up(1);
            stdout.write(t);
            readline.cursorTo(stdout, 0);
            cursor.down(1);
        });
        if (clip) {
            stdout.write(colors.reset(`> ${clip}`));
        }
    };
    return {
        log: (text) => print(colors.cyan(text)),
        messageIn: text => print(colors.yellow(text)),
        messageOut: text => print(text),
        error: (text, ...other) => console.error(colors.bgRed(text), other.length ? other : "")
    };
})();

let messageScanner;
const cleanUpAndQuit = browser => {
    let closing = false;
    return async () => {
        log("\nShutting down...\n\n");
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
    const tryPrint = async () => {
        try {
            log("Fetching QR code");
            await page.waitFor(SEL_QR, { timeout: 60000 });
            await (await page.$(SEL_QR)).screenshot({ path: qrFile });
            log("Processing code");
            qrDecoder.callback = (err, result) => {
                if (err) throw err;
                log("Generating QR display");
                stdout.write('\n\n');
                qrcode.generate(result.result);
                stdout.write('\n\n');
                fs.unlink(qrFile, err => !fs.existsSync(qrFile) || error(err || "Error deleting QR file"));
            }
            qrDecoder.decode((await jimp.read(fs.readFileSync(qrFile))).bitmap);
        } catch (e) {
            error(`Error: ${JSON.stringify(e)}\nRetrying...`);
            setTimeout(tryPrint, 3000);
        }
    };
    await tryPrint();
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

    stdin.on('data', key => {
        const keyCode = key.charCodeAt(0);
        // ctrl-c ( end of text )
        if (key === '\u0003') {
            cleanUpAndQuit(browser)();
        }
        if (/^[a-zA-Z0-9 `¬¦!"£\$%\^\&\*\(\)_\+-=\[\]\{\};:'@#~,<\.>\/?\\\|\r\n]*$/g.test(key)) {
            stdout.write(key == "\r" ? "\n" : key);
            if (key == "\r") {
                readAnswer(clip);
                clip = "";
            } else {
                clip += key
            }
        } else if (keyCode == 8 && clip) {
            const linesToDel = Math.ceil((clip.length + 2) / stdout.columns);
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

        page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/60.0.3112.78 Safari/537.36");

        log("Loading...");
        await page.goto('https://web.whatsapp.com');

        await printQRcode(page);
        log("Scan QR code with WhatsApp on your phone to log in");

        await page.waitFor(SEL_CHATLIST, { timeout: 60000 });
        log("Log in success!");

        const people = await page.$$(SEL_PEOPLE);

        const printPeople = async () => {
            for (let i = 0; i < people.length; i++) {
                log(`${i + 1} - ${await (await people[i].getProperty('textContent')).jsonValue()}`);
            }
        };

        await printPeople();

        log("Who would you like to chat to?");
        readAnswer(async (answer) => {
            let lastMessage;
            const printMessage = async msg => {
                const inMsg = await msg.$(SEL_IN_MESSAGE);
                const outMsg = await msg.$(SEL_OUT_MESSAGE);
                const theMessage = (inMsg || outMsg);
                if (theMessage) {
                    const msgText = await (await theMessage.getProperty('textContent')).jsonValue();
                    if (outMsg) {
                        messageOut(`> ${msgText}`);
                    } else {
                        messageIn(`> ${lastMessage = msgText}`);
                    }
                }
            };
            people[parseInt(answer) - 1].click();
            await page.waitFor(SEL_MSG, { timeout: 60000 });
            const msgs = (await page.$$(SEL_MSG));
            for (const msg of msgs) {
                await printMessage(msg);
            }
            messageScanner = setInterval(async () => {
                const msg = (await page.$$(SEL_IN_MESSAGE)).slice(-1)[0];
                if (msg) {
                    const msgContent = await (await msg.getProperty('textContent')).jsonValue();
                    if (lastMessage && lastMessage != msgContent) {
                        messageIn(`> ${msgContent}`);
                        if (!clip) {
                            stdout.write("> ");
                        }
                    }
                    lastMessage = msgContent;
                }
            }, 200);
            const readInput = () => readAnswer(async (line: string) => {
                if (line.trim()) {
                    await (await page.$(SEL_MSG_INPUT)).type(` ${line}`);
                    await page.waitFor(SEL_BUTTON_SEND, { timeout: 60000 });
                    (await page.$(SEL_BUTTON_SEND)).click();
                }
                readInput();
            });
            readInput();
        });
    } catch (e) {
        error(JSON.stringify(e));
        console.trace();
        cleanUpAndQuit(browser)();
    }
})();