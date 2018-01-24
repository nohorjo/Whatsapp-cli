import * as puppeteer from 'puppeteer';
import * as readline from 'readline';
import * as fs from 'fs';
import * as jimp from 'jimp';
import * as qrcode from 'qrcode-terminal';

const SEL_QR = 'img';
const SEL_CHATLIST = ".chatlist-panel-body";
const SEL_PEOPLE = '.chat-title > span';

const URL = 'https://web.whatsapp.com';
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/60.0.3112.78 Safari/537.36";

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const cleanUpAndQuit = browser => {
    let closing = false;
    return async () => {
        console.log("Shutting down...");
        rl.close()
        if(!closing){
            closing = true;
            try{ await browser.close(); } catch(e) {}                
        }
        process.exit();
    }
};

const printQRcode = async (page) => {
    const qrFile = "qr.png";
    await (await page.$(SEL_QR)).screenshot({path: qrFile});
    const qrDecoder = new (require('qrcode-reader'))();
    qrDecoder.callback = function(error, result) {
        if(error) throw error;
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
    const browser = await puppeteer.launch({headless:process.argv[2]!='s'});
    process.on("SIGINT", cleanUpAndQuit(browser));
    
    try {
        const page = await browser.newPage();
        
        page.setUserAgent(USER_AGENT);
        
        console.log("Loading...");
        await page.goto(URL);
        
        printQRcode(page);
        console.log("Scan QR code with WhatsApp on your phone tp log in");
    
        await page.waitFor(SEL_CHATLIST, {timeout:60000});
        console.log("Log in success!");
        
        const people = await page.$$(SEL_PEOPLE);
        
        const printPeople = () => people.forEach(async (person,i)=>{
            console.log(`${i + 1} - ${await (await person.getProperty('textContent')).jsonValue()}`);
        });
        
        printPeople();

    } catch(e) {
        console.error(e);
        cleanUpAndQuit(browser)();
    }
})();