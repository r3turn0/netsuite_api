const pg = require('pg')
require('dotenv').config();

const config = {
    user: process.env.USER,
    password: process.env.PASSWORD,
    host: process.env.HOST,
    port: process.env.PORT,
    database: process.env.DATABASE,
    schema: process.env.SCHEMA
};
console.log('Connecting to PostgreSQL Database using configuration: ', config)

// Remove the shared client, use pool or create client per function
const pool = new pg.Pool(config);
const client = new pg.Client(config);


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
    const table = await tableInfoQuery('product_ext').then(function(data){
        if(data) {
            return data;
        }
    });
    const res = await queryTable(`SELECT * FROM integration.product_ext`).then(function(data){
        if(data) {
            return data;
        }
    });
    console.log('The table', table)
    console.log('The integration.product_ext table', res);
}

main();   
