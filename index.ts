import * as puppeteer from 'puppeteer';
import * as opn from 'opn';
import * as readline from 'readline';



(async () => {
    const browser = await puppeteer.launch();

    (()=>{
        let closing = false;
        if (process.platform === "win32") {
            var rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout
            });
            
            rl.on("SIGINT", () => process.emit("SIGINT"));
        }
          
        process.on("SIGINT", async () => {
            console.log("Shutting down...");
            if(!closing){
                closing = true;
                try{ await browser.close(); } catch(e) {}                
            }
            process.exit();
        })
    })();

    const page = await browser.newPage();

    page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/60.0.3112.78 Safari/537.36");

    console.log("Loading...");
    await page.goto('https://web.whatsapp.com');

    let qr = "qr.png";
    page.screenshot({path: qr}).then(()=>{
        console.log("Scan QR code with Whatsapp on your phone");
        opn(qr);
    });

    await page.waitFor(".chatlist-panel-body");
    console.log("Log in success!");

    let people = await page.$$('.chat-title > span');

    for(let i = 0; i < people.length; i++)
        console.log(`${i} - ${await (await people[i].getProperty('textContent')).jsonValue()}`);
    
  
})();