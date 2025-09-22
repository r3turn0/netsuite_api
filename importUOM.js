import pg from 'pg';
//const pg = require('pg')
import { NetsuiteApiClient } from 'netsuite-api-client';
//const netsuiteClient = require('netsuite-api-client');
import dotenv from 'dotenv';
import fs from 'fs';
import csv from 'fast-csv';
dotenv.config();
const inputFolder = process.argv[2] || './csv/input/';

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
//const client = new pg.Client(config);
const nClient = new NetsuiteApiClient(nConfig);

// This function runs a query to get column names and data types from information_schema for a specified table in PostgreSQL
async function tableInfoQuery(table) {
    const client = new pg.Client(config);
    try {
        await client.connect();
        // SELECT column_name, data_type FROM information_schema.columns WHERE table_schema= 'integration' AND table_name = 'product_ext';
        const infoQuery = `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = '${process.env.SCHEMA}' AND table_name = '${table}';`;
        const res = await client.query(infoQuery);
        return new Promise((resolve, reject) => {
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
    const client = new pg.Client(config);
    try {
        await client.connect();
        const res = await client.query(sql);
        return new Promise((resolve, reject) => {
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
async function postRecord(p, b, r, m) {
    try {
        const response = await nClient.request({
            path: p,
            body: JSON.stringify(b),
            restletUrl: r || null,
            method: m || 'POST'
        });
        console.log('Response from postRecord:', response);
        return new Promise((resolve, reject) => {
            if(response.statusCode === 204 || response.statusCode === 200 || response.data && response.data.success === true) {
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

// This function gets vendors with optional limit and offset
async function getInventoryItem(limit,offset) {
    try {
        const inventoryItem = await getRecords(
            'inventoryItem', // Path
            null, // Query
            limit ? limit : null,
            offset ? offset : null
        );
        console.log('inventoryItem:', inventoryItem);
        return new Promise((resolve, reject) => {
            if(inventoryItem.length > 0) {
                resolve(inventoryItem);
            }
            else {
                reject(new Error('No inventoryItem found'));
            }
        });
    } catch (error) {
        console.error('Error fetching vendors:', error);
        throw error;
    }
}

// This function gets all inventory items in batches of 1000
async function getInventoryItems(numRecords, offset) {
    let inventory = [];
    while (numRecords > 0) {
        const batchSize = Math.min(1000, numRecords);
        try {
            const items = await getInventoryItem(batchSize, offset);
            console.log('Inventory Items:', items);
            inventory.push(items);
        } catch (error) {
            console.error('Error in getInventoryItem:', error);
        }
        numRecords -= batchSize;
        offset = 0; // Reset offset after the first batch
    }
    return inventory.flat();
}

// This function gets UOMs with optional limit and offset
async function getUOM(limit,offset) {
    let uoms = [];
    try {
        const items = await getRecords(
            'inventoryItem', // Path
            null, // Query
            limit ? limit : null,
            offset ? offset : null
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
async function getVendor(limit, offset) {
    try {
        const vendors = await getRecords(
            'vendor', // Path
            null, // Query
            limit ? limit : null,
            offset ? offset : null
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
async function postVendor(p, b, r, m) {
    const method = m || 'POST';
    const restletUrl = r || null;
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
        const response = await postRecord(path, body, restletUrl, method);
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
async function postInventoryItem(p, b, r, m) {
    const method = m || 'POST';
    const restletUrl = r || null;
    const path = p || 'inventoryItem';
    const body = b || {
        "itemId": "ACS-TESTITEM6",
        "taxSchedule": "1",
        "itemType":"inventoryitem"
    }
    try {
        const response = await postRecord(path, body, restletUrl, method);
        console.log('Response from postInventoryItem:', response);
        return response;
    }
    catch(e) {
        console.log('Error in postInventoryItem:', e);
        throw e;
    }
}

// Post a UOM, requires that an inventoryItem or externalId to be created first to link to the UOM
async function postUOM(p, b, r, m) {
    const method = m || 'POST';
    const restletUrl = r || null;
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
        const response = await postRecord(path, body, restletUrl, method);
        console.log('Response from postUOM:', response);
        return response;
    }
    catch(e) {
        console.log('Error in postInventoryItem:', e);
        throw e;
    }
}

// Function to read a CSV file and return an array of objects
async function readCsvToObjects(folderPath) {
    const files = fs.readdirSync(folderPath).filter(file => file.endsWith('.csv'));
    let allResults = [];
    for (const file of files) {
        const filePath = `${folderPath}/${file}`;
        const results = await new Promise((resolve, reject) => {
            const rows = [];
            fs.createReadStream(filePath)
                .pipe(csv.parse({ headers: true }))
                .on('error', error => reject(error))
                .on('data', row => rows.push(row))
                .on('end', () => resolve(rows));
        });
        allResults = allResults.concat(results);
    }
    return allResults;
}

// The following functions read from CSV files or Postgres tables to post the data to Netsuite

// This function reads vendors from a CSV file and posts them to Netsuite
async function addVendor(file, sql) {
    try {
        if(file) {
            const vendors = await readCsvToObjects(inputFolder);
            console.log('Vendors from CSV:', vendors); 
            for (const vendor of vendors) {
                const v = {
                    "customForm": {
                        "id": "-10020",
                        "refName": "Standard Vendor Form_2",
                    },
                    entityId: vendor.ID,
                    companyName: vendor.Name ? vendor.Name : vendor.ID,
                    email: vendor.Email,
                    phone: vendor.Phone,
                    altPhone: vendor['Office Phone'],
                    fax: vendor.Fax,
                    altEmail: vendor['Alt Email'],
                    url: vendor['Web Address'],
                    defaultAddress : vendor['Billing Address'],
                    //defaultShippingAddress: vendor['Shipping Address'],
                    isInactive: vendor.Inactive ? 'Yes' ? true : false : false,
                    subsidiary: `${vendor.subsidiary_id}`
                }
                    const response = await postVendor('vendor', v);
                    console.log('Vendor posted successfully:', response);
                }
            }
            else {
                const data = await queryTable(sql || 'SELECT * FROM integration.vendor');
                console.log('Data from vendor_ext:', data);
                if (data && data.rows && data.rows.length > 0) {
                    // Map vendor_ext headers to Netsuite keys
                    const netsuiteKeyMap = {
                        "customForm": {
                            "id": "-10020",
                            "refName": "Standard Vendor Form_2",
                        },
                        entityId: 'entityId',
                        companyName: 'companyName',
                        email: 'email',
                        phone: 'phone',
                        altPhone: 'officePhone',
                        fax: vendor.Fax,
                        altEmail: 'altEmail',
                        url: 'webAddress',
                        defaultAddress : 'billingAddress',
                        //defaultShippingAddress: vendor['Shipping Address'],
                        isInactive: 'inactive',
                        subsidiary: 'subsidiary'
                    }
                    for (const row of data.rows) {
                    const netsuiteVendor = {};
                    for (const [header, netsuiteKey] of Object.entries(netsuiteKeyMap)) {
                        const matchedKey = Object.keys(row).find(
                            k => k.toLowerCase().includes(header.toLowerCase())
                        );
                        // 1. Direct match
                        if (row.hasOwnProperty(header.replace(' ', '').toLowerCase())) {
                            netsuiteVendor[netsuiteKey] = row[header];
                        }
                        // 2. Partial match
                        else if (matchedKey) {
                            netsuiteVendor[netsuiteKey] = row[matchedKey];
                        }
                        else {
                            // 3. Default mapping (optional: set to null or provide a default value)
                            if(netsuiteKey === 'itemType') {
                                netsuiteVendor[netsuiteKey] = 'inventoryitem';
                            }
                            else {
                                netsuiteVendor[netsuiteKey] = null;
                            }
                        }
                    }
                    // Post to Netsuite
                    try {
                        const response = await postVendor('vendor', netsuiteVendor, process.env.BASE_URL_REST);
                        console.log('Posted vendor:', response);
                    } catch (err) {
                        console.error('Error posting vendor:', err);
                    }
                    }  
                }
            }
        }
        catch (error) {
            console.error('Error in addVendor:', error);
        }
    }
    
    // THis function reads inventory items from a CSV file and posts them to Netsuite
    async function addInventoryItem(file, sql) {
        try {
        if(file === true) {
        const items = await readCsvToObjects(inputFolder);
        for (const item of items) {
            const i = {
                itemType: "inventoryitem",
                internalId: item['Internal ID'],
                name: item['Name'],
                externalId: item['External ID'],
                itemId: item['External ID'],
                displayName: item['Display Name'],
                inactive: item['Inactive'],
                description: item['Description'],
                type: item['Type'],
                unitPrice: item['Unit Price'],
                purchasePrice: item['Purchase Price'],
                priceByUom: item['Price by UOM'],
                basePrice: item['Base Price'],
                primaryPurchaseUnit: item['Primary Purchase Unit'],
                primaryStockUnit: item['Primary Stock Unit'],
                primarySaleUnit: item['Primary Sale Unit'],
                salesQtyPerPackUnit: item['Sales Qty Per Pack Unit'],
                salesPackagingUnit: item['Sales Packaging Unit'],
                pcsInABox: item['Pcs in a Box'],
                sqftByPcsSheet: item['SQFT by Pcs/Sheet'],
                sqftByBox: item['SQFT By Box'],
                saleUnit: item['Sale Unit'],
                priceLevel: item['Price Level'],
                itemNumberAndName: item['Item Number and Name'],
                itemNameOnly: item['Item Name Only'],
                customShopifyVariantId: item['CUSTOM SHOPIFY VARIANT ID'],
                weightPerSf: item['WEIGHT PER SF'],
                weightPerPc: item['WEIGHT PER PC'],
                vendor: item['Vendor'],
                itemCollection: item['Item Collection'],
                subType: item['SubType'],
                subsidiary: item['Subsidiary'] ? "Elit Tile Consolidated : ElitTile.com" ? "3" : "1" : "1",
                vendorCode: item['Vendor Code'],
                vendorName: item['Vendor Name'],
                series: item['SERIES'],
                itemSize: item['Item Size'],
                itemColor: item['Item Color'],
                finish: item['FINISH'],
                tileShape: item['Tile Shape'],
                mosaicShape: item['Mosaic Shape'],
                mosaicChipSize: item['Mosaic Chip Size'],
                class: item['Class'],
                className: item['Class Name'],
                subClass: item['Sub-Class'],
                design: item['Design'],
                side: item['Side'],
                thickness: item['THICKNESS'],
                oldPackaging: item['Old Packaging'],
                oldPackagingDate: item['Old Packaging Date'],
                shape: item['SHAPE'],
                edge: item['EDGE'],
                nameInWebsite: item['Name in Website'],
                unitType: item['Unit Type'],
                parent: item['Parent'],
                includeChildren: item['Include Children'],
                department: item['Department'],
                location: item['Location'],
                costingMethod: item['Costing Method'],
                purchaseDescription: item['Purchase Description'],
                stockDescription: item['Stock Description'],
                matchBillToReceipt: item['Match Bill To Receipt'],
                useBins: item['Use Bins'],
                reorderMultiple: item['Reorder Multiple'],
                autoReorderPoint: item['Auto Reorder Point'],
                autoLeadTime: item['Auto Lead Time'],
                safetyStockLevel: item['Safety Stock Level'],
                transferPrice: item['Transfer Price'],
                preferredLocation: item['Preferred Location'],
                binNumber: item['Bin Number'],
                vendorSchedule: item['Vendor Schedule'],
                taxSchedule: item['Tax Schedule'] ? "Taxable" ? "1" : "2" : "2",
                dropShipItem: item['Drop Ship Item'],
                weight: item['Weight'],
                weightOfSellUnitShopify: item['Weight of sell-unit Shopify'],
                idShopify: item['ID Shopify'],
                depth: item['Depth'],
                width: item['Width'],
                height: item['Height'],
                netsuiteECode: item['NetSuite E Code'],
                netsuiteVCode: item['NetSuite V Code']
            }
                const response = await postInventoryItem('inventoryItem', i, process.env.BASE_URL_REST);
                console.log('inventoryItem posted successfully:', response);
            }
        }
        else {
            const fields = await tableInfoQuery('product');
            console.log('Fields from product:', fields);
            const data = await queryTable(sql || 'SELECT * FROM integration.product');
            console.log('Data from product:', data);
            if (data && data.rows && data.rows.length > 0) {
                // Map product_ext headers to Netsuite keys
                const netsuiteKeyMap = {
                    // product table column : netsuite key
                    'item_type': 'itemType',
                    'internalid': 'id',
                    'itemid': 'itemId',
                    'name': 'name',
                    'externalid': 'externalId',
                    'displayname': 'displayName',
                    'isinactive': 'isinactive',
                    'description': 'description',
                    'type': 'itemType',
                    'unit_price': 'unitPrice',
                    'purchase_price': 'purchasePrice',
                    'custitem_bit_pricebysqft': 'priceByUom',
                    'base_price': 'basePrice',
                    'primary_purchase_unit': 'primaryPurchaseUnit',
                    'primary_stock_unit': 'primaryStockUnit',
                    'primary_sale_Unit': 'primarySaleUnit',
                    'sales_qty_per_pack_unit': 'salesQtyPerPackUnit',
                    'sales_packaging_unit': 'salesPackagingUnit',
                    'pcs_in_a_box': 'pcsInABox',
                    'sqft_by_pcs_sheet': 'sqftByPcsSheet',
                    'sqft_by_box': 'sqftByBox',
                    'sale_unit': 'saleUnit',
                    'price_level': 'priceLevel',
                    'item_number_and_name': 'itemNumberAndName',
                    'item_name_only': 'itemNameOnly',
                    'custom_shopify_variant_id': 'customShopifyVariantId',
                    'weight_per_sf': 'weightPerSf',
                    'weight_per_pc': 'weightPerPc',
                    'vendor': 'vendor',
                    'item_collection': 'itemCollection',
                    'subtype': 'subType',
                    'subsidiary': 'subsidiary',
                    'vendor_code': 'vendorCode',
                    'vendor_name': 'vendorName',
                    'series': 'series',
                    'item_size': 'itemSize',
                    'item_color': 'itemColor',
                    'finish': 'finish',
                    'tile_shape': 'tileShape',
                    'mosaic_shape': 'mosaicShape',
                    'mosaic_chip_size': 'mosaicChipSize',
                    'class': 'class',
                    'class_name': 'className',
                    'sub_class': 'subClass',
                    'design': 'design',
                    'side': 'side',
                    'thickness': 'thickness',
                    'old_packaging': 'oldPackaging',
                    'old_packaging_date': 'oldPackagingDate',
                    'shape': 'shape',
                    'edge': 'edge',
                    'name_in_website': 'nameInWebsite',
                    'unit_type': 'unitsType',
                    'parent': 'parent',
                    'include_children': 'includeChildren',
                    'department': 'department',
                    'location': 'location',
                    'costing_method': 'costingMethod',
                    'purchase_description': 'purchaseDescription',
                    'stock_description': 'stockDescription',
                    'match_bill_to_receipt': 'matchBillToReceipt',
                    'use_bins': 'useBins',
                    'reorder_multiple': 'reorderMultiple',
                    'auto_reorder_point': 'autoReorderPoint',
                    'auto_lead_time': 'autoLeadTime',
                    'safety_stock_level': 'safetyStockLevel',
                    'transfer_price': 'transferPrice',
                    'preferred_location': 'preferredLocation',
                    'bin_number': 'binNumbers',
                    'vendor_schedule': 'vendorSchedule',
                    'tax_schedule': 'taxSchedule',
                    'drop_ship_item': 'isDropShipItem',
                    'weight': 'weight',
                    'weight_of_sell_unit_shopify': 'custitem9',
                    'id_shopify': 'custitem4',
                    'depth': 'custitembit_depth',
                    'width': 'custitem_bit_width',
                    'height': 'custitembit_height',
                    'netsuiteECode': 'custitemnetsuite_e_code',
                    'netsuiteECode': 'custitem11'
                };
                for(var i = 0; i < fields.rows.length; i++) {
                    if(fields.rows[i].column_name && !netsuiteKeyMap[fields.rows[i].column_name]) {
                        netsuiteKeyMap[fields.rows[i].column_name] = fields.rows[i].column_name; // Default to same name if no mapping exists
                        console.log(`No mapping found for column: ${fields.rows[i].column_name}`);
                    }
                }
                const netsuiteItem = {
                    itemType: 'inventoryitem' // Default value,
                };
                for (const row of data.rows) {
                    for (const [header, netsuiteKey] of Object.entries(netsuiteKeyMap)) {
                        if(netsuiteKey === 'subsidiary') {
                            netsuiteItem[netsuiteKey] = row['subsidiary'] ? row['subsidiary'] : 10;
                        }
                        const matchedKey1 = Object.keys(row).find(
                            k => k.toLowerCase().includes(header.replace(' ','_').toLowerCase())
                        );
                        const matchedKey2 = Object.keys(row).find(
                            k => k.toLowerCase().includes(netsuiteKey.toLowerCase())
                        );
                        // 1. Direct match
                        if (row.hasOwnProperty(header.replace(' ', '_').toLowerCase())) {
                            netsuiteItem[netsuiteKey] = row[header.replace(' ', '_').toLowerCase()];
                        }
                        else if(row.hasOwnProperty(header.replace(' ', '').toLowerCase())) {
                            netsuiteItem[netsuiteKey] = row[header.replace(' ', '').toLowerCase()];
                        }
                        // 2. Partial match
                        else if (matchedKey1) {
                            netsuiteItem[netsuiteKey] = row[matchedKey1];
                        }
                        else if(matchedKey2) {
                            netsuiteItem[netsuiteKey] = row[matchedKey2];
                        }
                        // Try to match netsuiteKey to a row header (case-insensitive)
                        else if (
                            Object.keys(row).some(
                                k => k.toLowerCase() === netsuiteKey.toLowerCase()
                            )
                        ) {
                            const exactKey = Object.keys(row).find(
                                k => k.toLowerCase() === netsuiteKey.toLowerCase()
                            );
                            netsuiteItem[netsuiteKey] = row[exactKey];
                        }
                        else {
                            // 3. Default mapping (optional: set to null or provide a default value)
                            if(netsuiteKey === 'itemType') {
                                netsuiteItem[netsuiteKey] = 'inventoryitem';
                            }
                            else if(netsuiteKey === 'isinactive') {
                                netsuiteItem[netsuiteKey] = row['inactive'] ? true : false;
                            }
                            else if(netsuiteKey === 'taxschedule') {
                                netsuiteItem[netsuiteKey] = row['taxschedule'] ? "Taxable" ? "1" : "2" : "2";
                            }
                            else {
                                netsuiteItem[netsuiteKey] = null;
                            }
                        }
                    }
                    // Post to Netsuite
                    try {
                        console.log('Netsuite Item to be posted:', netsuiteItem);
                        netsuiteItem.itemId = row['externalid'];
                        netsuiteItem.id = row['internalid'] || null;
                        const response = await postInventoryItem('inventoryItem', netsuiteItem, process.env.BASE_URL_REST);
                        console.log('Posted inventoryItem from product:', response);
                        const updateResponse = await postInventoryItem('inventoryItem', netsuiteItem);
                        console.log('Updated inventoryItem from product:', updateResponse);
                    } catch (err) {
                        console.error('Error posting inventoryItem from product:', err);
                    }
                }   
            } else {
                console.log('No data found in product table.');
            }
        }
    }
    catch (error) {
        console.error('Error in inventoryItem:', error);
    }
}

// This function reads UOMs from a CSV file and posts them to Netsuite
async function addUOM(file, sql) {
    try {
        if(file) {
        const uoms = await readCsvToObjects(inputFolder);
        for (const uom of uoms) { 
            const u = {
                "externalId": uom['Item(Type Name)'],
                "isInactive": uom['inactive'] ? true : false,
                "name": uom['Item(Type Name)'],
                "uom": {
                    "items": [
                        {
                            "unitName": uom['Unit Name (Name)'],
                            "pluralName": uom['Plural Name'],
                            "abbreviation": uom.Abbreviation,
                            "pluralAbbreviation": uom['Plural Abbreviation'],
                            "conversionRate": Number(uom['Conversion Rate (/Base)']),
                            "baseUnit": uom['Base Unit'] ? 'YES' ? true : false : false,
                            "inUse": uom['in Use'] ? true : false,
                        }
                    ]
                }
            }
                const response = await postUOM('unitsType', u);
                console.log('UOM posted successfully:', response);
            }
        }
        else {
            const data = await queryTable(sql || 'SELECT * FROM integration.uom');
            console.log('Data from uom:', data);
            if (data && data.rows && data.rows.length > 0) {
                for (const row of data.rows) {
                    const netsuiteItem = {
                        "externalId": row['externalid'],
                        "isInactive": row['inactive'] ? true : false,
                        "name": row['name'],
                        'uom': {
                                'items': [{
                                        unitName: row['unitname'],
                                        pluralName: row['pluralname'],
                                        abbreviation: row['abbreviation'],
                                        pluralAbbreviation: row['pluralabbreviation'],
                                        conversionRate: Number(row['conversionrate']),
                                        baseUnit: row['baseunit'] ? 'YES' ? true : false : false,
                                        inUse: row['inuse'] ? true : false
                                    }
                                ]
                            }
                        }
                    // Post to Netsuite
                    try {
                        console.log('Netsuite Uom to be posted:', netsuiteItem);
                        const response = await postUOM('unitsType', netsuiteItem);
                        console.log('Posted unitsType', response);
                    } catch (err) {
                        console.error('Error posting UOM:', err);
                    }
                }
            }
            else {
                console.log('No data found in UOM table.');
            }
        }
    }
    catch (error) {
        console.error('Error in the UOM:', error);
    }
}

// Sample function calls to demonstrate usage

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

// postUOM().then((response) => {
//     console.log('UOM posted successfully:', response);
// }).catch((error) => {
//     console.error('Error in postUOM:', error);
// });

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

// Run the desired function(s) here: 

//addUOM();
//addInventoryItem();
//addVendor();

async function insertInventoryItem() {
    const sql = 'SELECT * from integration.product ORDER BY externalid LIMIT 1';
    try {
        const inventoryResponse = await addInventoryItem(false, sql);
        console.log('Inventory Item Response:', inventoryResponse);
    }
    catch(e) {
        console.log('Error in insertInventoryItem:', e);
    }
}

async function insertUOM() {
    const sql = 'SELECT * from integration.UOM';
    try {
        const uomResponse = await addUOM(false, sql);
        console.log('UOM Response:', uomResponse);
    }
    catch(e) {
        console.log('Error in insertUOM:', e);
    }
}

async function insertVendor() {
    const sql = 'SELECT * from integration.vendor';
    try {
        const vendorResponse = await addVendor(false, sql);
        console.log('Vendor Response:', vendorResponse);
    }
    catch(e) {
        console.log('Error in insertVendor:', e);
    }
}

// Inserts UOMs from the UOM table in PostgreSQL database integration.uom schema to Netsuite database
//insertInventoryItem();
insertUOM();
//insertVendor();
