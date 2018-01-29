import * as puppeteer from 'puppeteer';
import * as readline from 'readline';
import * as fs from 'fs';
import * as jimp from 'jimp';
import * as qrcode from 'qrcode-terminal';
import * as colors from 'colors';
import { setInterval, clearTimeout } from 'timers';

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

let messageScanner;

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const cleanUpAndQuit = browser => {
    let closing = false;
    return async () => {
        console.log("Shutting down...");
        rl.close()
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
    await page.waitFor(SEL_QR, { timeout: 60000 });
    await (await page.$(SEL_QR)).screenshot({ path: qrFile });
    const qrDecoder = new (require('qrcode-reader'))();
    qrDecoder.callback = function (error, result) {
        if (error) throw error;
        qrcode.generate(result.result);
    }
    qrDecoder.decode((await jimp.read(fs.readFileSync(qrFile))).bitmap);
    fs.unlink(qrFile, err => console.error(err || ""));
};

(() => {
    if (process.platform === "win32") {
        rl.on("SIGINT", () => {
            process.emit("SIGINT");
        });
    }
})();

(async () => {
    const browser = await puppeteer.launch({
        headless: process.argv[2] != 's',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    process.on("SIGINT", cleanUpAndQuit(browser));

    try {
        const page = await browser.newPage();

        page.setUserAgent(USER_AGENT);

        console.log("Loading...");
        await page.goto(URL);

        await printQRcode(page);
        console.log("Scan QR code with WhatsApp on your phone to log in");

        await page.waitFor(SEL_CHATLIST, { timeout: 60000 });
        console.log("Log in success!");

        const people = await page.$$(SEL_PEOPLE);


        const printPeople = async () => {
            for (let i = 0; i < people.length; i++) {
                console.log(`${i + 1} - ${await (await people[i].getProperty('textContent')).jsonValue()}`);
            }
        };

        await printPeople();

        rl.question("Who would you like to chat to?\n> ", async (answer) => {
            let lastMessage;
            const printMessage = async msg => {
                const inMsg = await msg.$(SEL_IN_MESSAGE);
                const outMsg = await msg.$(SEL_OUT_MESSAGE);
                const theMessage = (inMsg || outMsg);
                if (theMessage) {
                    const msgText = await (await theMessage.getProperty('textContent')).jsonValue();
                    if (outMsg) {
                        console.log(msgText);
                    } else {
                        lastMessage = msgText;
                        console.log(colors.green(msgText));
                    }
                }

            };
            people[parseInt(answer) - 1].click();
            await page.waitFor(SEL_MSG, { timeout: 60000 });
            const msgs = (await page.$$(SEL_MSG)).slice(-LAST_N_MESSAGES);
            // msgs.forEach(await printMessage);
            for (const msg of msgs) {
                await printMessage(msg);
            }
            messageScanner = setInterval(async () => {
                const msg = (await page.$$(SEL_IN_MESSAGE)).slice(-1)[0];
                if (msg) {
                    const msgContent = await (await msg.getProperty('textContent')).jsonValue();
                    if (lastMessage && lastMessage != msgContent) {
                        console.log(colors.green(msgContent));
                    }
                    lastMessage = msgContent;
                }
            }, 200);
            const readInput = () => rl.question("> ", async line => {
                if (line) {
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