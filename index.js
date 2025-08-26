import pg from 'pg';
//const pg = require('pg')
import { NetsuiteApiClient } from 'netsuite-api-client';
//const netsuiteClient = require('netsuite-api-client');
import dotenv from 'dotenv';
import fs from 'fs';
import csv from 'fast-csv';
dotenv.config();
const inputFolder = process.argv[2] || 'csv/input/';

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
    consumer_key: process.env.CONSUMER_KEY_SB,
    consumer_secret_key: process.env.CONSUMER_SECRET_SB, // ensure this matches your .env variable name
    token: process.env.TOKEN_SB,
    token_secret: process.env.TOKEN_SECRET_SB,
    base_url: process.env.BASE_URL_SB,
    realm: process.env.REALM_SB
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

// This function runs a query to get column names and data types from information_schema for a specified table in PostgreSQL
async function tableInfoQuery(table) {
    try {
        await client.connect();
        const infoQuery = `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '${table}';`;
        const res = await client.query(infoQuery);
        new Promise((resolve, reject) => {
            if(res) {
                resolve(res);
            }
            else {
                reject(new Error('No records found in queryTable Query:', sql));
            }
        });
    } catch (err) {
        console.log('Error in executing information schema query for tableInfoQuery', err);
    }
    finally {
        await client.end();
    } 
}

// This function runs a query to get records from a specified table in PostgreSQL
async function queryTable(sql) {
    try {
        await client.connect();
        const res = await client.query(sql);
        new Promise((resolve, reject) => {
            if(res) {
                resolve(res);
            }
            else {
                reject(new Error('No records found in queryTable Query:', sql));
            }
        });
    }
    catch(err){
        console.log('Error in executing queryTable Query', err);
    }
    finally {
        await client.end();
    }
}

// This function gets records from Netsuite with optional query, limit, and offset
async function getRecords(p, q, l, o) {
    console.log('The netsuite client:', nClient);
    let records = [];
    let recs = [];
    //const table = await tableInfoQuery('product_ext');
    //const res = await queryTable(`SELECT * FROM integration.product_ext`);
    //console.log('The table', table)
    //console.log('The integration.product_ext table:', res);
    try {
        if(q) {
            console.log('Query:', q);
            records = await nClient.query(q, l, o);
        }
        else {
            if(l || o) {
                recs = await nClient.request({
                    path: `/${p}?limit=${l}&offset=${o}`,
                    method: 'GET'
                });
                if(recs.data) {
                    const items = recs.data.items;
                    //console.log('The links', links);
                    console.log('The items', items);
                    // Here you can process the items or links as needed
                    if(items && items.length > 0) {
                        for(var i = 0; i < items.length; i++){
                            console.log('Gathering', p, 'item:', items[i].id);
                            await nClient.request({
                                path: `/${p}/`+items[i].id,
                                method: 'GET'
                            }).then((item) => {
                                records.push(item);
                                //console.log('Item:', item);
                            });
                        }
                    }
                }
                else {
                    console.log('No data from Netsuite');
                }
            }
            else {
                recs = await nClient.request({
                    path: `/${p}`,
                    method: 'GET'
                });
                //console.log(p, 'items:', records);
                if(recs.data) {
                    records.push(recs.data);
                }
                else {
                    console.log('No data from Netsuite');
                }
            }
            return new Promise((resolve, reject) => {
                if(records.length > 0) {
                    resolve(records);
                }
                else {
                    reject(new Error('No records found'));
                }
            });
        }
    } catch (error) {
        console.error('Error fetching records:', error);
    }
}

// This function posts a record to Netsuite
async function postRecord(p, b, r) {
    try {
        const response = await nClient.request({
            path: p,
            body: JSON.stringify(b),
            method: 'POST',
            restletUrl: r || null
        });
        console.log('Response from postRecord:', response);
        return new Promise((resolve, reject) => {
            if(response.statusCode === 204) {
                resolve(response);
            }
            else {
                reject(new Error('No data returned from postRecord', b));
            }
        });
    }
    catch(e) {
        console.log('Error in postRecord:', e);
        throw e; // Re-throw the error to be handled by the caller
    }
}

// This function gets UOMs with optional limit and offset
async function getUOM() {
    let uoms = [];
    try {
        const items = await getRecords(
            'inventoryItem', // Path
            null, // Query
            10,
            10
        );
        console.log('Fetch Records Result:');
        for (const item of items) {
            console.log(item);
            if (item.data.unitsType.links.length > 0) {
                const unitsTypeLinks = item.data.unitsType.links;
                console.log('UOM Links:', unitsTypeLinks);
                for (const link of unitsTypeLinks) {
                    let l = link.href.split('unitstype/')[1];
                    try {
                        const unitsType = await getRecords(
                            'unitstype/' + l, // Path
                            null, // Query
                            null,
                            null
                        );
                        console.log('unitsType:', unitsType);
                        for (const uType of unitsType) {
                            const uom = uType.uom;
                            for (const uomLink of uom.links) {
                                console.log('UOM Link:', uomLink);
                                let uomId = uomLink.href.split('uom')[1];
                                try {
                                    const uomData = await getRecords(
                                        'unitstype/' + l + '/uom/' + uomId
                                    );
                                    console.log('UOM Data:', uomData);
                                    if (uomData[0] && uomData[0].items) {
                                        for (const uomItem of uomData[0].items) {
                                            console.log('UOM Item:', uomItem);
                                            uoms.push(uomItem);
                                        }
                                    }
                                } catch (error) {
                                    console.error('Error fetching UOM Data:', error);
                                }
                            }
                        }
                    } catch (error) {
                        console.error('Error fetching unitsType:', error);
                    }
                }
            }
        }
        return new Promise((resolve, reject) => {
            if(uoms.length > 0) {
                resolve(uoms);
            }
            else {
                reject(new Error('No uoms found'));  
            }
        });
    } catch (e) {
        console.log('Error in getUOM:', e);
        throw e;
    }
}

// This function gets vendors with optional limit and offset
async function getVendor() {
    try {
        const vendors = await getRecords(
            'vendor', // Path
            null, // Query
            10,
            10
        );
        console.log('Vendors:', vendors);
        return new Promise((resolve, reject) => {
            if(vendors.length > 0) {
                resolve(vendors);
            }
            else {
                reject(new Error('No vendors found'));
            }
        });
    } catch (error) {
        console.error('Error fetching vendors:', error);
        throw error;
    }
}

// Post a vendor, requires a customForm and subsidiary to be set
async function postVendor(p, b) {
    const path = p || 'vendor';
    const body = b || {
        "companyName": "Vendor Test Ericta2",
        "customForm": {
            "id": "-10020",
            "refName": "Standard Vendor Form_2"
        },
        "entityId": "J0001",
        "subsidiary": "3"
    }
    try {
        const response = await postRecord(path, body);
        console.log('Response from postVendor:', response.statusCode, response.data);
        return new Promise((resolve, reject) => {
            if(response.statusCode === 204) {
                resolve(response);
            }
            else {
                reject(new Error('No data returned from postVendor', b));
            }
        });
    }
    catch (error) {
        console.error('Error in postVendor:', error);
        throw error;
    }
}

// Post an inventoryItem that requires a TaxSchedule to be set and this example uses a RESTlet URL
async function postInventoryItem(p, b, r) {
    const restletUrl = r || null;
    const path = p || 'inventoryItem';
    const body = b || {
        "itemId": "ACS-TESTITEM2",
        "taxSchedule": "1",
        "itemType":"inventoryitem",
    }
    try {
        const response = await postRecord(path, body, restletUrl);
        console.log('Response from postInventoryItem:', response);
        return response;
    }
    catch(e) {
        console.log('Error in postInventoryItem:', e);
        throw e;
    }
}

// Post a UOM, requires that an inventoryItem be created first to link to the UOM
async function postUOM(p, b) {
    const path = p || 'unitsType';
    const body = b || {
        "externalId": "ACS-TESTITEM1",
        "isInactive": false,
        "name": "Each",
        "uom": {
            "items": [
                {
                    "abbreviation": "EA",
                    "baseUnit": true,
                    "conversionRate": 1,
                    "inUse": true,
                    "pluralAbbreviation": "EAS",
                    "pluralName": "Eaches",
                    "name": "Each",
                    "unitName": "Each"
                }
            ]
        }
    }
    try {
        const response = await postRecord(path, body);
        console.log('Response from postUOM:', response);
        return response;
    }
    catch(e) {
        console.log('Error in postInventoryItem:', e);
        throw e;
    }
}

// Function to read a CSV file and return an array of objects
async function readCsvToObjects(filePath) {
    return new Promise((resolve, reject) => {
        const results = [];
        fs.createReadStream(filePath)
            .pipe(csv.parse({ headers: true }))
            .on('error', error => reject(error))
            .on('data', row => results.push(row))
            .on('end', () => resolve(results));
    });
}

// The following functions read from CSV files and post the data to Netsuite

// This function reads vendors from a CSV file and posts them to Netsuite
async function addVendor() {
    try {
        const vendors = await readCsvToObjects(inputFolder);
        console.log('Vendors from CSV:', vendors); 
        for (const vendor of vendors) {
            const response = await postVendor('vendor', vendor);
            console.log('Vendor posted successfully:', response);
        }
    }
    catch (error) {
        console.error('Error in addVendor:', error);
    }
}

// THis function reads inventory items from a CSV file and posts them to Netsuite
async function addInventoryItem() {
    try {
        const items = await readCsvToObjects(inputFolder);
        for (const item of items) {
            const response = await postInventoryItem('inventoryItem', item, process.env.BASE_URL_REST);
            console.log('inventoryItem posted successfully:', response);
        }
    }
    catch (error) {
        console.error('Error in inventoryItem:', error);
    }
}

// This function reads UOMs from a CSV file and posts them to Netsuite
async function addUOM() {
    try {
        const uoms = await readCsvToObjects(inputFolder);
        for (const uom of uoms) { 
            const response = await postUOM('unitsType', uom);
            console.log('UOM posted successfully:', response);
        }
    }
    catch (error) {
        console.error('Error in UOM:', error);
    }
}

// getUOM().then((uoms) => {
//     console.log('UOMs:', uoms);
//     if(uoms && uoms.length > 0) {
//     uoms.forEach((uom) => {
//         uom.links.forEach(async (item) => {
//             if(item) {
//                 console.log('UOM Item:', item);
//                 let uomPath = item.href.split('/v1/')[1];
//                 const uomData = await getRecords(
//                     uomPath, // Path
//                     null, // Query
//                     null,
//                     null
//                 );
//                 console.log('UOM Record:', uomData);
//             }
//             else {
//                 console.log('No UOM Record found for item:', item);
//             }
//         });
//     });
// }
// else {
//     console.log('No UOMs found');
// }
// }).catch((error) => {
//     console.error('Error in getUOMs:', error);
// }); 

// getVendor().then((vendors) => {
//     console.log('Vendors:', vendors);
// }).catch((error) => {
//     console.error('Error in getVendor:', error);
// });

// postVendor().then((response) => {
//     console.log('Vendor posted successfully:', response);
// }).catch((error) => {
//     console.error('Error in postVendor:', error);
// });

postUOM().then((response) => {
    console.log('UOM posted successfully:', response);
}).catch((error) => {
    console.error('Error in postUOM:', error);
});

// postInventoryItem('','',process.env.BASE_URL_REST).then((response) => {
//     console.log('Inventory Item:', response)
// });

// const sql = sqlQuery.Query(); 
// sql.select('taxSchedule').from('inventoryItem').build();
// console.log(typeof sql, 'SQL Query:', sql); 
// getRecords(
//     'inventoryItem', // Path
//     null, // Query
//     null,
//     null
// ).then((items) => {
//     console.log('Inventory Items:', items);
// }).catch((error) => {
//     console.error('Error in getRecords:', error);
// });

