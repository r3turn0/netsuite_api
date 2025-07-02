import pg from 'pg';
//const pg = require('pg')
import { NetsuiteApiClient } from 'netsuite-api-client';
//const netsuiteClient = require('netsuite-api-client');
import dotenv from 'dotenv';
dotenv.config();

// For PG
const config = {
    user: process.env.USER,
    password: process.env.PASSWORD,
    host: process.env.HOST,
    port: process.env.PORT,
    database: process.env.DATABASE,
    schema: process.env.SCHEMA
};
console.log('Connecting to PostgreSQL Database using configuration: ', config)

const nConfig = {
    consumer_key: process.env.CONSUMER_KEY,
    consumer_secret_key: process.env.CONSUMER_SECRET, // ensure this matches your .env variable name
    token: process.env.TOKEN,
    token_secret: process.env.TOKEN_SECRET,
    base_url: process.env.BASE_URL_TEST,
    realm: process.env.REALM_TEST
}

// Check for missing Netsuite config
for (const [key, value] of Object.entries(nConfig)) {
    if (!value) {
        console.error(`Missing Netsuite config value for: ${key}`);
    }
}

// Remove the shared client, use pool or create client per function
const pool = new pg.Pool(config);
const client = new pg.Client(config);
const nClient = new NetsuiteApiClient(nConfig);

async function tableInfoQuery(table) {
    try {
        await client.connect();
        const infoQuery = `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '${table}';`;
        const res = await client.query(infoQuery);
        if(res){
            console.log('tableInfoQuery:', res);
            return res;
        }
        else {
            console.log('No records');
        }
    } catch (err) {
        console.log('Error in executing information schema query for tableInfoQuery', err);
    }
    finally {
        await client.end();
    } 
}

async function queryTable(sql) {
    try {
        await client.connect();
        const res = await client.query(sql);
        if(res) {
            console.log('queryTable', res);
            return res;
        }
        else {
            console.log('No records found in queryTable Query:', sql);
        }
    }
    catch(err){
        console.log('Error in executing queryTable Query', err);
    }
    finally {
        await client.end();
    }
}

async function main() {
    const table = await tableInfoQuery('product_ext');
    const res = await queryTable(`SELECT * FROM integration.product_ext`);
    console.log('The table', table)
    console.log('The integration.product_ext table:', res);
    console.log('The netsuite client:', nClient);
    try {
        const inventoryItems = await nClient.request({
            path: '/inventoryItem',
            method: 'GET'
        });
        console.log('Inventory Items:', inventoryItems);
        if(inventoryItems.data) {
            const links = inventoryItems.data.links;
            const items = inventoryItems.data.items;
            console.log('The links', links);
            console.log('The items', items);
        }
        else {
            console.log('No data from Netsuite');
        }
    } catch (error) {
        console.error('Error fetching inventory items:', error);
    }
}

main();   
