const axios = require('axios');
const express = require('express');
const { start } = require('repl');

const PORT = 3000;
const app = express();

const ADDRESS_WBNB = "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c";
const ADDRESS_USDT = "0x55d398326f99059ff775485246999027b3197955";
const ONE_DAY = 86400;

function dateToTimestamp(date) {
    let year = parseInt(date.substr(0, 4));
    let month = parseInt(date.substr(5, 2)) - 1;
    let day = parseInt(date.substr(8, 2));
    let tz = new Date().getTimezoneOffset() / 60;
    return Math.floor((new Date(year, month, day)).getTime() / 1000) - (tz * 3600);
}

function timestampToDate(timestamp) {
    var date = new Date(timestamp * 1000);
    return date.getFullYear() + "-"
        + ("0" + (date.getMonth() + 1)).substr(("0" + (date.getMonth() + 1)).length - 2) + "-" 
        + ("0" + date.getDate()).substr(("0" + date.getDate()).length - 2);
}

async function getPastPrices_(baseToken, quoteToken, startDate, cnt) {
    var data = JSON.stringify({
        query: `{
        ethereum(network: bsc){
            dexTrades(options: {limit: ` + cnt + `, asc: "timeInterval.day"},
            date: {since:"` + startDate + `"}
            exchangeName: {in:["Pancake","Pancake v2"]},
            baseCurrency: {is: "` + baseToken + `"},
            quoteCurrency: {is: "` + quoteToken + `"}){
                timeInterval {
                    day(count: 1)
                }
                baseCurrency {
                    symbol
                    address
                }
                baseAmount
                quoteCurrency {
                    symbol
                    address
                }
                quoteAmount
                trades: count
                quotePrice
                maximum_price: quotePrice(calculate: maximum)
                minimum_price: quotePrice(calculate: minimum)
                open_price: minimum(of: block get: quote_price)
                close_price: maximum(of: block get: quote_price)
            }
        }
    }`,
        variables: {}
    });

    var config = {
        method: 'post',
        url: 'https://graphql.bitquery.io',
        headers: {
            'Content-Type': 'application/json'
        },
        data: data
    };

    try {
        const resp = await axios(config);
        let datas = resp.data["data"]["ethereum"]["dexTrades"];
        let rlt = {};
        let prices = [];
        let totPrice = 0;
        let totVolume = 0;
        datas.forEach(d => {
          let price = d["close_price"];
          let volume = d["baseAmount"];
          prices.push({
            "date" : dateToTimestamp(d["timeInterval"]["day"]),
            "volume" : volume,
            "price" : price
          });
          totPrice += price * volume;
          totVolume += volume;
        });
        rlt["prices"] = prices;
        rlt["vwap"] = totPrice / totVolume;
        return { success: true, data: rlt};
    }
    catch (error) {
        return { success: false, msg: error };
    };
}

async function getPastPrices(token, startTimestamp, endTimestamp) {
    if (!((new Date(startTimestamp * 1000)).getTime() > 0)) {
        return { success: false, msg: "StartTimestamp is invalid" };
    }
    startTimestamp = parseInt(startTimestamp / ONE_DAY) * ONE_DAY;
    if (!((new Date(endTimestamp * 1000)).getTime() > 0)) {
        return { success: false, msg: "EndTimestamp is invalid" };
    }
    endTimestamp = parseInt(endTimestamp / ONE_DAY) * ONE_DAY;
    if (startTimestamp > endTimestamp) {
        return { success: false, msg: "StartTimestamp must be equal or earlier than EndTimestamp" };
    }
    let startDate = timestampToDate(startTimestamp);
    let dateCnt = ((endTimestamp - startTimestamp) / ONE_DAY) + 1;
    let tkn_bnb = await getPastPrices_(
        token,
        ADDRESS_WBNB,
        startDate,
        dateCnt);
    if (!tkn_bnb.success) {
        return { success: false, msg: "Invalid token address" };
    }
    tkn_bnb = tkn_bnb.data;
    let bnb_usd = await getPastPrices_(
        ADDRESS_WBNB,
        ADDRESS_USDT,
        startDate,
        dateCnt);
    if (!bnb_usd.success) return bnb_usd;
    bnb_usd = bnb_usd.data;
    let tkn_usd = {
        success: true
    };
    let prices = [];
    let totVolume = 0;
    let totPrice = 0;
    if (tkn_bnb["prices"].length !== dateCnt || bnb_usd["prices"].length !== dateCnt ||
        tkn_bnb["prices"][0]["date"] !== startTimestamp || bnb_usd["prices"][0]["date"] !== startTimestamp
    ) {
        return { success: false, msg: "timestamps are out of valid range" };
    }
    for (let i = 0; i < dateCnt; i++) {
        let price = parseFloat(tkn_bnb["prices"][i]["price"]) * parseFloat(bnb_usd["prices"][i]["price"]);
        prices.push({
            "date": tkn_bnb["prices"][i]["date"],
            "volume": parseFloat(tkn_bnb["prices"][i]["volume"]),
            "price": price
        });
        totPrice += parseFloat(tkn_bnb["prices"][i]["volume"]) * price;
        totVolume += parseFloat(tkn_bnb["prices"][i]["volume"]);
    }
    tkn_usd["prices"] = prices;
    tkn_usd["vwap"] = totPrice / Math.max(totVolume, 0.0001);
    return tkn_usd;
}

// getPastPrices("0xe9e7cea3dedca5984780bafc599bd69add087d56", 1549312452, 1549412452).then(resp => {
//     console.log("result = ", resp);
// });

app.get('/past', async function (req, res) {
    let rlt = await getPastPrices(req.query["token"], req.query["start"], req.query["end"]);
    res.send(rlt);
})

app.listen(PORT);
