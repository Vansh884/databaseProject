import express from 'express';
import axios from 'axios';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import path from 'path';
import bcrypt from "bcrypt";
import Groq from "groq-sdk";
import multer from 'multer';
import Papa from 'papaparse';
import env from "dotenv";

env.config();
const groqApiKey = process.env.GROQ_API_KEY;
const groq = new Groq({ apiKey:  groqApiKey});
const upload = multer({ storage: multer.memoryStorage() });

const port = 3000;
const app = express();
const __dirname = dirname(fileURLToPath(import.meta.url));
const api_url = 'http://localhost:4000';

// let username  = null;
// let password = null;

let username = 'nisha', password = 'nisha';

app.set('view engine', 'ejs');
app.use(express.static(__dirname + '/staticfolder'));

app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));


app.get('/', function(req, res){
    return res.render(__dirname + '/ejs/index.ejs');
});

app.get('/login', function(req, res){
    if (req.query.message === 'error'){
        return res.render(__dirname + '/ejs/login.ejs', {error: 'Incorrect Username or Password'});
    }
    else{
        return res.render(__dirname + '/ejs/login.ejs', {error: null});
    }
});

app.get('/profile', async function(req, res){
    if (username===null || password===null){
        return res.redirect('/login');
    }
    console.log(username, password)
    const resp = await axios.post(api_url + '/get_authentication_data', {username: username, password: password});
    return res.render(__dirname + '/ejs/profile.ejs', {firstName: resp.data.firstname, lastName: resp.data.lastname, username: resp.data.username, lastLoggedIn: resp.data.last_logged_in, password: password});
});

app.post('/change_profile', async function(req, res){
    let data = req.body;
    if (req.body.submit === 'logout'){
        username = null;
        password = null;
        return res.redirect('/login');
    }
    else if (req.body.submit === 'change_password'){
        return res.render(__dirname + '/ejs/change_password.ejs', {error: 'false', firstname: data.firstname, lastname: data.lastname, username: data.username, password: data.password});
    }
    else if (req.body.submit === 'edit_profile'){
        return res.render(__dirname + '/ejs/edit_profile.ejs', {firstname: data.firstname, lastname: data.lastname, username: data.username, password: data.password});
    }
    else if (req.body.submit === 'delete_account'){
        username = null;
        password = null;
        
        try{
            api_res = await axios.post(api_url + '/delete_account', {firstname: data.firstname, lastname: data.lastname, username: data.username, password: data.password});
            console.log(api_res.data.message);
        }
        catch(e){
            console.error('error deleting account ', e);
        }
        return res.redirect('/login');
    }
});

app.post('/change_password', async function(req, res){
    let data = req.body;
    if (req.body.submit === 'cancel'){
        res.redirect('/profile');
    }
    else if (req.body.submit === 'change'){
        if (data.confirmnewpassword === data.newpassword){
            const resp = await axios.post(api_url + '/changepassword', {firstname: data.firstname, lastname: data.lastname,
             username: data.username, password: data.password,
             newpassword: data.newpassword});
             console.log('hey')
             return res.redirect('/login');
        }
        else{
            return res.render(__dirname + '/ejs/change_password.ejs', {error: 'true', firstname: data.firstname, lastname: data.lastname, username: data.username, password: data.password});
        }
    }
});

app.post('/edit_profile', async function(req, res){
    console.log(req.body.username, req.body.password)
    if (req.body.submit === 'cancel'){
        return res.redirect('/profile');
    }
    else if (req.body.submit === 'change'){
        let data = req.body;
        const resp = await axios.post(api_url + '/editprofile', {firstname: data.firstname, lastname: data.lastname,
             username: data.username, password: data.password,
            oldusername: data.oldusername});
        return res.redirect('/login');
    }    
});

app.get('/signup', function(req, res){
    return res.render(__dirname + '/ejs/signup.ejs');
});

app.get('/startpage',async function(req, res){

    if (username===null || password===null){
        return res.redirect('/login');
    }

    let choice1 = null;
    let extra_data = null; //for inserting new file or database
    let filename = null;
    let databasename = null;
    let message = '';
    let type= null;
    let time = null;

    if (req.query.message != null) message = req.query.message;
    if (req.query.time !== null) time = req.query.time;

    if (req.query.filename != null) filename = req.query.filename;
    if (req.query.databasename != null) databasename = req.query.databasename;

    //for selection menu options
    if (req.query.choice !== null || req.query.choice !== undefined){
        choice1 = req.query.choice;
        console.log(choice1);

        if (choice1 === 'insertrow'){
            extra_data = {
                filename: req.query.filename,
                columns: JSON.parse(req.query.columns)
            };
        }
        else if (choice1 === 'selectrow' || choice1 === 'deleterow'){
            extra_data = { columns: JSON.parse(req.query.columns)};
        }
        else if (choice1 === 'selectkeyvalue' || choice1 === 'deletekeyvalue'){
            extra_data = { data: JSON.parse(req.query.data)}
        }
        else if (choice1 === 'updaterow' || choice1 === 'updatekeyvalue' || choice1 === 'sort' || choice1 === 'visualizedata' || choice1 === 'visualizedataresult'){
            extra_data = { data: JSON.parse(req.query.data)};
        }
        else if (choice1 === 'tableschema' || choice1 === 'changeschema' || choice1 === 'jsonschema' || choice1?.endsWith('split')){
            extra_data = { data: JSON.parse(req.query.data)};
            console.log(extra_data.data)
        }
        else if (choice1?.endsWith('join')){
            extra_data = { data : JSON.parse(req.query.files)};
            console.log(extra_data)
        }
        else if (choice1 === 'querytool'){
            extra_data = {data: JSON.parse(req.query.queries)};
            console.log(extra_data.data)
        }
    }
    //for output showing

    if (message.endsWith('_rowData') && typeof message === 'string'){
        message = message.replace('_rowData','')

        let parsed_data = await axios.post(api_url + '/get_result', {username: username, password: password, databasename: databasename});
        parsed_data = parsed_data.data;
        extra_data = { rows: parsed_data.rows, columns: parsed_data.columns };

        type = parsed_data.type;
    }
    else if (message.endsWith('_keyValueData') && typeof message === 'string'){
        message = message.replace('_keyValueData','')

        let parsed_data = await axios.post(api_url + '/get_result', {username: username, password: password, databasename: databasename});
        console.log(parsed_data.data)
        parsed_data = parsed_data.data;

        extra_data = parsed_data;

        type = 'json';
    }

    const api_res = await axios.get(api_url + '/get_databases', {params : { username: username, password: password}});
    const databases = api_res.data.databases;
    

    return res.render(__dirname + '/ejs/startpage.ejs', {
        username : username, password: password,
        databases: databases, message1: choice1,
        extra_data: extra_data,
        filename: filename, databasename: databasename,
        message: message, time: time, type: type});
});

app.post('/register', function(req, res){
    let req_register = req.body.register;
    if (req_register === 'Login'){
        return res.redirect('/login');
    }
    else if (req_register === 'Sign Up'){
        return res.redirect('/signup');
    }
});

app.post('/entry', function(req, res){
    if (username === null && password === null){
        return res.redirect('/login')
    }
    else{
        return res.redirect('/startpage');
    }
});

app.post('/login',async function(req, res){
    const details = req.body;
    const resp = await axios.post(api_url + '/serverlogin', {details: details});

    if (resp.data.flag === 1){
        // res.redirect('/welcome');
        username = req.body.username;
        password = req.body.password;
        return res.redirect('/startpage');
    }
    else if (resp.data.flag === 0){
        return res.redirect('/login?message=error');
    }
});

app.post('/signup', async function(req, res){
    const req_details = req.body;


    //
    await axios.post(api_url + '/serversignup', {details: req_details});
    //


    username = req.body.username;
    password = req.body.password;

    try{
        const api_res = await axios.post(api_url + '/newuser', {username : username, password: password});
        console.log(api_res.data.message);
    }
    catch(e){
        console.error('error posting username and password ', e);
    }
    
    return res.redirect('/startpage');
});

app.post('/user_dropdown', async function(req, res){
    if (req.body.submit === 'logout'){
        username = null;
        password = null;
        return res.redirect('/login');
    }
    else if (req.body.submit === 'profile'){
        return res.redirect('/profile');
    }
});

app.post('/tools',async function(req, res){
    console.log(req.body.tool)
    const req_choice = req.body.tool;
    const filename = req.body.filename;
    const databasename = req.body.databasename;
    if (req_choice === 'Insert File'){
        return res.redirect('/startpage?choice=insertfile');
    }
    else if (req_choice === 'Insert Database'){
        return res.redirect('/startpage?choice=insertdatabase');
    }
    else if (req_choice === 'Delete File'){
        return res.redirect('/startpage?choice=deletefile');
    }
    else if (req_choice === 'Delete Database'){
        return res.redirect('/startpage?choice=deletedatabase');
    }
    else if (req_choice === 'Rename File'){
        return res.redirect('/startpage?choice=renamefile');
    }
    else if (req_choice === 'Rename Database'){
        return res.redirect('/startpage?choice=renamedatabase');
    }
    else if (req_choice === 'insertrow'){
        try{
            const api_res = await axios.post(api_url + '/columndetails', {username : username, password: password, filename: filename, databasename: databasename});
            const query = encodeURIComponent(JSON.stringify(api_res.data.columns));
            
            return res.redirect(`/startpage?choice=insertrow&filename=${filename}&databasename=${databasename}&columns=${query}`);
        }
        catch(e){
            console.error('error retrieving file columnar details')
        }
    }
    else if (req_choice === 'insertkeyvalue'){
        return res.redirect(`/startpage?choice=insertkeyvalue&filename=${filename}&databasename=${databasename}`);
    }
    else if (req_choice === 'selectrow'){
        try{
            const api_res = await axios.post(api_url + '/columndetails', {username : username, password: password, filename: filename, databasename: databasename});
            const query = encodeURIComponent(JSON.stringify(api_res.data.columns));
            
            return res.redirect(`/startpage?choice=selectrow&filename=${filename}&databasename=${databasename}&columns=${query}`);
        }
        catch(e){
            console.error('error retrieving file columnar details')
        }
    }
    else if (req_choice === 'selectkeyvalue'){
        try{
            const api_res = await axios.post(api_url + '/filedetails', {username : username, password: password, filename: filename, databasename: databasename});
            const query = encodeURIComponent(JSON.stringify(api_res.data));
            
            return res.redirect(`/startpage?choice=selectkeyvalue&filename=${filename}&databasename=${databasename}&data=${query}`);
        }
        catch(e){
            console.error('error retrieving file details ', e);
        }
    }
    else if (req_choice === 'updaterow'){
        try{
            const api_res = await axios.post(api_url + '/columndetails', {username : username, password: password, filename: filename, databasename: databasename});
            const query = encodeURIComponent(JSON.stringify(api_res.data.columns));

            return res.redirect(`/startpage?choice=updaterow&filename=${filename}&databasename=${databasename}&data=${query}`);
        }
        catch(e){
            console.error('error updating row ', e);
        }
    }
    else if (req_choice === 'updatekeyvalue'){
        try{
            const api_res = await axios.post(api_url + '/filedetails', {username : username, password: password, filename: filename, databasename: databasename});
            const query = encodeURIComponent(JSON.stringify(api_res.data));
            
            return res.redirect(`/startpage?choice=updatekeyvalue&filename=${filename}&databasename=${databasename}&data=${query}`);
        }
        catch(e){
            console.error('error retrieving file details ', e);
        }
    }
    else if (req_choice === 'deleterow'){
        try{
            const api_res = await axios.post(api_url + '/columndetails', {username : username, password: password, filename: filename, databasename: databasename});
            const query = encodeURIComponent(JSON.stringify(api_res.data.columns));
            
            return res.redirect(`/startpage?choice=deleterow&filename=${filename}&databasename=${databasename}&columns=${query}`);
        }
        catch(e){
            console.error('error retrieving file columnar details')
        }
    }
    else if (req_choice === 'deletekeyvalue'){
        try{
            const api_res = await axios.post(api_url + '/filedetails', {username : username, password: password, filename: filename, databasename: databasename});
            const query = encodeURIComponent(JSON.stringify(api_res.data));
            
            return res.redirect(`/startpage?choice=deletekeyvalue&filename=${filename}&databasename=${databasename}&data=${query}`);
        }
        catch(e){
            console.error('error retrieving file details ', e);
        }
    }
    else if (req_choice === 'tableschema'){
        try{
            const api_res = await axios.post(api_url + '/columndetails', {username : username, password: password, filename: filename, databasename: databasename});
            console.log(api_res.data)
            const query = encodeURIComponent(JSON.stringify(api_res.data));
            
            return res.redirect(`/startpage?choice=tableschema&filename=${filename}&databasename=${databasename}&data=${query}`);
        }
        catch(e){
            console.error('error retrieving file columnar details')
        }
    }
    else if (req_choice === 'jsonschema'){
        try{
            const api_res = await axios.post(api_url + '/columndetails', {username : username, password: password, filename: filename, databasename: databasename});
            console.log(api_res.data)
            const query = encodeURIComponent(JSON.stringify(api_res.data));
            
            return res.redirect(`/startpage?choice=jsonschema&filename=${filename}&databasename=${databasename}&data=${query}`);
        }
        catch(e){
            console.error('error retrieving file columnar details')
        }
    }
    else if (req_choice === 'querytool'){
        console.log(filename);
        try{
            const api_res = await axios.post(api_url + '/queryhistory', {username : username, password: password, filename: filename, databasename: databasename});
            const query = encodeURIComponent(JSON.stringify(api_res.data.history));
            
            return res.redirect(`/startpage?choice=querytool&filename=${filename}&databasename=${databasename}&queries=${query}`);
        }
        catch(e){
            console.error('error retrieving query history details')
        }
        
    }
    else if (req_choice?.endsWith('join')){
        try{
            const api_res= await axios.post(api_url + '/databasedetails', {username : username, password: password, filename: filename, databasename: databasename});
            const query = encodeURIComponent(JSON.stringify(api_res.data));
            return res.redirect(`/startpage?choice=${req_choice}&filename=${filename}&databasename=${databasename}&files=${query}`);
        }
        catch(e){
            console.log('error retrieving file details',e)
        }
    }
    else if (req_choice?.endsWith('split')){
        try{
            const api_res = await axios.post(api_url + '/columndetails', {username : username, password: password, filename: filename, databasename: databasename});
            console.log(api_res.data)
            const query = encodeURIComponent(JSON.stringify(api_res.data));
            
            return res.redirect(`/startpage?choice=${req_choice}&filename=${filename}&databasename=${databasename}&data=${query}`);
        }
        catch(e){
            console.error('error splitting table')
        }
    }
    else if (req_choice === 'sort'){
        try{
            const api_res = await axios.post(api_url + '/columndetails', {username : username, password: password, filename: filename, databasename: databasename});
            const query = encodeURIComponent(JSON.stringify(api_res.data.columns));
            
            return res.redirect(`/startpage?choice=sort&filename=${filename}&databasename=${databasename}&data=${query}`);
        }
        catch(e){
            console.error('error retrieving file columnar details')
        }
    }
    else if (req_choice === 'visualizedata'){
        try{
            const api_res = await axios.post(api_url + '/columndetails', {username : username, password: password, filename: filename, databasename: databasename});
            const query = encodeURIComponent(JSON.stringify(api_res.data));
            
            return res.redirect(`/startpage?choice=visualizedata&filename=${filename}&databasename=${databasename}&data=${query}`);
        }
        catch(e){
            console.error('error retrieving file columnar details')
        }
    }
    else if (req_choice === 'find'){
        return res.redirect(`/startpage?choice=find&filename=${filename}&databasename=${databasename}`);
    }
    else if (req_choice === 'changeschema'){
        try{
            const api_res = await axios.post(api_url + '/columndetails', {username : username, password: password, filename: filename, databasename: databasename});
            console.log(api_res.data)
            const query = encodeURIComponent(JSON.stringify(api_res.data));
            
            return res.redirect(`/startpage?choice=changeschema&filename=${filename}&databasename=${databasename}&data=${query}`);
        }
        catch(e){
            console.error('error retrieving file columnar details')
        }
    }
    else if (req_choice === 'import'){
        return res.redirect(`/startpage?choice=import&filename=${filename}&databasename=${databasename}`);
    }
    else if (req_choice === 'export'){
        return res.redirect(`/startpage?choice=export&filename=${filename}&databasename=${databasename}`);
    }

});

app.post('/insertdatabase',async function(req, res){
    const req_body = req.body;
    let api_res;

    const start = process.hrtime.bigint(); // high-res start
    try{
        api_res = await axios.post(api_url + '/newdatabase', {username : username, password: password, database_name : req_body.databasename});
        console.log(api_res.data.message);
    }
    catch(e){
        console.error('error creating new database ', e);
    }

    const end = process.hrtime.bigint();   // high-res end
    const durationMs = Number(end - start) / 1e6;
    return res.redirect(`/startpage?message=${api_res.data.message}&time=Executed%20in%20${durationMs}%20ms.`);
});

app.post('/insertfile', async function(req, res){
    const req_body = req.body;
    let api_res, i=1;
    console.log(req_body)

    let constraints = [];
    while(`columnname${i}` in req_body && `columntype${i}` in req_body){
        console.log('a')
        let temp = []
        if (req_body[`notnull${i}`] === 'on') temp.push('not_null')
        if (req_body[`primarykey${i}`] === 'on') temp.push('primary_key')
        if (req_body[`unique${i}`] === 'on') temp.push('unique')
        if (req_body[`serial${i}`] === 'on') temp.push('serial')
        constraints.push(temp)
        i++
    }
    console.log(constraints)
    const start = process.hrtime.bigint(); // high-res start
    try{
        api_res = await axios.post(api_url + '/newfile', {username : username, password: password, file_details : req_body, constraints: constraints});
        console.log(api_res.data.message);
    }
    catch(e){
        console.error('error creating new file ', e);
    }

    const end = process.hrtime.bigint();   // high-res end
    const durationMs = Number(end - start) / 1e6;
    return res.redirect(`/startpage?message=${api_res.data.message}&time=Executed%20in%20${durationMs}%20ms.`);
});

app.post('/deletedatabase', async function(req, res){
    console.log(req.body);
    const req_body = req.body;
    let api_res;

    const start = process.hrtime.bigint(); // high-res start
    try{
        api_res = await axios.post(api_url + '/deletedatabase', {username : username, password: password, database : req_body.database});
        console.log(api_res.data.message);
    }
    catch(e){
        console.error('error deleting database ', e);
    }

    const end = process.hrtime.bigint();   // high-res end
    const durationMs = Number(end - start) / 1e6;
    return res.redirect(`/startpage?message=${api_res.data.message}&time=Executed%20in%20${durationMs}%20ms.`);
});

app.post('/renamedatabase', async function(req, res){
    console.log(req.body);
    const req_body = req.body;
    let api_res;

    const start = process.hrtime.bigint(); // high-res start
    try{
        api_res = await axios.post(api_url + '/renamedatabase', {username : username, password: password, database : req_body.database, name: req_body.databasename});
        console.log(api_res.data.message);
    }
    catch(e){
        console.error('error renaming database ', e);
    }

    const end = process.hrtime.bigint();   // high-res end
    const durationMs = Number(end - start) / 1e6;
    return res.redirect(`/startpage?message=${api_res.data.message}&time=Executed%20in%20${durationMs}%20ms.`);
});

app.post('/deletefile', async function(req, res){
    console.log(req.body);
    const req_body = req.body;
    let api_res;

    const start = process.hrtime.bigint(); // high-res start
    try{
        api_res = await axios.post(api_url + '/deletefile', {username : username, password: password, database : req_body.database, file: req_body.file});
        console.log(api_res.data.message);
    }
    catch(e){
        console.error('error deleting file ', e);
    }

    const end = process.hrtime.bigint();   // high-res end
    const durationMs = Number(end - start) / 1e6;
    return res.redirect(`/startpage?message=${api_res.data.message}&time=Executed%20in%20${durationMs}%20ms.`);
});

app.post('/renamefile', async function(req, res){
    console.log(req.body);
    const req_body = req.body;
    let api_res;

    const start = process.hrtime.bigint(); // high-res start
    try{
        api_res = await axios.post(api_url + '/renamefile', {username : username, password: password, database : req_body.database, file: req_body.file, name: req_body.name});
        console.log(api_res.data.message);
    }
    catch(e){
        console.error('error renaming file ', e);
    }

    const end = process.hrtime.bigint();   // high-res end
    const durationMs = Number(end - start) / 1e6;
    return res.redirect(`/startpage?message=${api_res.data.message}&time=Executed%20in%20${durationMs}%20ms.`);
});

app.post('/insertrow',async function(req, res){
    let api_res;

    const req_data = req.body;
    const filename = req.body.filename, databasename = req.body.databasename;
    delete req_data.filename;
    delete req_data.databasename;
    console.log(req_data);

    let file_data, column_names = [];
    try{
        file_data = await axios.post(api_url + '/columndetails', {
            username: username, password: password,
            filename: filename, databasename: databasename
        });
        file_data.data.columns.forEach(column => {
            column_names.push(column.name)
        });
        // columnlength = columnlength.data.columns.length;
    }
    catch(e){
        console.log('error retrieving columns ', e);
    }

    let i = 1, rows = [];
    while(`row_${i}_col_${column_names[0]}` in req_data){
        let temp = {};
        column_names.forEach(c_name => {
            temp[c_name] = req_data[`row_${i}_col_${c_name}`]
        });
        i++;
        rows.push(temp);
    }

    const start = process.hrtime.bigint(); // high-res start
    try{
        api_res = await axios.post(api_url + '/insertrow', {
            username: username, password: password,
            filename: filename, databasename: databasename,
            rows: rows});
        console.log(api_res.data.message);
        
    }
    catch(e){
        console.log('error inserting row ', e);
        console.log(api_res.data.message);
    }
    const end = process.hrtime.bigint();   // high-res end
    const durationMs = Number(end - start) / 1e6;
    return res.redirect(`/startpage?message=${api_res.data.message}&time=Executed%20in%20${durationMs}%20ms.`);

});

app.post('/insertkeyvalue', async function(req, res){
    let api_res;

    const req_data = req.body;
    console.log(req_data);
    const filename = req.body.filename, databasename = req.body.databasename;
    delete req_data.filename;
    delete req_data.databasename;

    const start = process.hrtime.bigint(); // high-res start
    try{
        api_res = await axios.post(api_url + '/insertkeyvalue', {
            username: username, password: password,
            filename: filename, databasename: databasename,
            keyvalues: req_data});
        console.log(api_res.data.message);
    }
    catch(e){
        console.log('error inserting key-value pair ', e);
        console.log(api_res.data.message);
    }
    const end = process.hrtime.bigint();   // high-res end
    const durationMs = Number(end - start) / 1e6;
    return res.redirect(`/startpage?message=${api_res.data.message}&time=Executed%20in%20${durationMs}%20ms.`);
});

app.post('/selectrow',async function(req, res){
    let api_res;

    const req_data = req.body;
    const filename = req.body.filename, databasename = req.body.databasename;
    delete req_data.filename;
    delete req_data.databasename;

    let columnlength;
    try{
        columnlength = await axios.post(api_url + '/columndetails', {
            username: username, password: password,
            filename: filename, databasename: databasename
        });
        columnlength = columnlength.data.columns.length;
    }
    catch(e){
        console.log('error retrieving columns ', e);
    }

    //data sorting for custom columns
    let selected_columns = null;
    {   
        if (req_data.allcolumns === '*'){
            selected_columns = [];
            selected_columns.push('*');
            delete req_data.allcolumns;
        }
        else if (req_data.allcolumns === undefined ){
            for (let i = 1; i<=columnlength; i++){
                if (req_data[`column${i}`]){
                    if (selected_columns === null) 
                        selected_columns = [];
                    selected_columns.push(req_data[`column${i}`]);
                    delete req_data[`column${i}`];
                }
            }
        }
    }

    let conditions = null;
    {
            let i = 1;
            while(req_data[`columns${i}`] && req_data[`operations${i}`] && req_data[`value${i}`]){
                if (i === 1) conditions = [];
                let value=req_data[`value${i}`];
                if (value.includes(',') && req_data[`operations${i}`]==='in'){
                    value=value.split(',')
                }
                conditions.push([req_data[`columns${i}`], req_data[`operations${i}`], value]);
                i += 1;
            }
        }
        console.log(conditions)

    console.log(selected_columns);
    console.log(conditions);

    let query = null;

    const start = process.hrtime.bigint(); // high-res start

    try{
        api_res = await axios.post(api_url + '/selectrow', {
            username: username, password: password,
            filename: filename, databasename: databasename,
            selected_columns: selected_columns, predefinedoptions: req_data.predefinedoptions,
            conditions: conditions
        });
        // console.log(api_res.data);
        query = encodeURIComponent(JSON.stringify(api_res.data));
        console.log(api_res.data);
    }
    catch(e){
        console.log('error retrieving row ', e);
        console.log(api_res.data.message);
    }
    const end = process.hrtime.bigint();   // high-res end
    const durationMs = Number(end - start) / 1e6;
    return res.redirect(`/startpage?message=${api_res.data.message}&time=Executed%20in%20${durationMs}%20ms.&filename=${filename}&databasename=${databasename}&extradata=${query}`);
});

app.post('/selectkeyvalue', async function(req, res){
    console.log(req.body);
    let api_res;
    const filename = req.body.filename, databasename = req.body.databasename;
    const req_body = req.body;
    delete req_body.filename;
    delete req_body.databasename;

    //pre sorting data
    let selected_keys = [];
    for (let key in req_body){
        if (key === 'predefinedoptions') continue
        
        if (key.startsWith('select')) selected_keys.push(req_body[key])
        else selected_keys.push(parseInt(req_body[key]))
    }

    const start = process.hrtime.bigint(); // high-res start
    try{
        api_res = await axios.post(api_url + '/selectkeyvalue', {
            username: username, password: password,
            filename: filename, databasename: databasename,
            predefinedoptions: req_body.predefinedoptions, 
            selected_keys: selected_keys
        });
        console.log(api_res.data)
        const end = process.hrtime.bigint();   // high-res end
        const durationMs = Number(end - start) / 1e6;
        return res.redirect(`/startpage?message=${api_res.data.message}&time=Executed%20in%20${durationMs}%20ms.&filename=${filename}&databasename=${databasename}`);
    }
    catch(e){
        console.error('error retrieving key value ', e);
        return res.redirect(`/startpage?message=key-value selection unsuccessful`);
    }
});

app.post('/updaterow', async function(req, res){
    console.log(req.body);

    let api_res;
    const req_data = req.body;
    const filename = req.body.filename, databasename = req.body.databasename;
    delete req_data.filename;
    delete req_data.databasename;

    //columns presorting
    let columns = null
    let keys = Object.keys(req_data);
    for (let i = 0; i<keys.length; i++){
        if (i === 0) columns = [];

        if (keys[i].startsWith('column')){
            let column_detail = req_data[keys[i]].split('_');

            let column_name = column_detail[0];
            let column_value;
            if (column_detail[1] == 'int') column_value = parseInt(req_data[keys[i+1]]);
            else if (column_detail[1] == 'float') column_value = parseFloat(req_data[keys[i+1]]);
            else column_value = req_data[keys[i+1]];

            columns.push([column_name, column_value]);

            delete req_data[keys[i]];
            delete req_data[keys[i+1]];
        }
    }
    console.log(columns);

    //conditions presorting
    let conditions = null;
    {
            let i = 1;
            while(req_data[`conditioncolumn${i}`] && req_data[`conditionoperation${i}`] && req_data[`conditionvalue${i}`]){
                if (i === 1) conditions = [];
                let value=req_data[`conditionvalue${i}`];
                if (value.includes(',') && req_data[`conditionoperation${i}`]==='in'){
                    value=value.split(',')
                }
                conditions.push([req_data[`conditioncolumn${i}`], req_data[`conditionoperation${i}`], value]);
                i += 1;
            }
        }
    console.log(conditions)

    const start = process.hrtime.bigint(); // high-res start
    try{
        api_res = await axios.post(api_url + '/updaterow', {
            username: username, password: password,
            filename: filename, databasename: databasename,
            conditions: conditions, columns: columns
        });
        console.log(api_res.data.message);
    }
    catch(e){
        console.error('error updating value ', e);
    }
    const end = process.hrtime.bigint();   // high-res end
    const durationMs = Number(end - start) / 1e6;
    return res.redirect(`/startpage?message=${api_res.data.message}&time=Executed%20in%20${durationMs}%20ms.`);

});

app.post('/updatekeyvalue', async function(req, res){
    console.log(req.body);
    let api_res;
    const filename = req.body.filename, databasename = req.body.databasename;
    const req_body = req.body;
    delete req_body.filename;
    delete req_body.databasename;

    const start = process.hrtime.bigint(); // high-res start
    try{
        api_res = await axios.post(api_url + '/updatekeyvalue', {
            username: username, password: password,
            filename: filename, databasename: databasename,
            selected_keys: req_body.selected_keys, update_value: req_body.update_value
        });
        
    }
    catch(e){
        console.error('error retrieving key value ', e);
    }
    const end = process.hrtime.bigint();   // high-res end
    const durationMs = Number(end - start) / 1e6;
    return res.redirect(`/startpage?message=${api_res.data.message}&time=Executed%20in%20${durationMs}%20ms.`);
});

app.post('/deleterow', async function(req, res){
    let api_res;

    const req_data = req.body;
    const filename = req.body.filename, databasename = req.body.databasename;
    delete req_data.filename;
    delete req_data.databasename;

    console.log(req.body);

    let columnlength;
    try{
        columnlength = await axios.post(api_url + '/columndetails', {
            username: username, password: password,
            filename: filename, databasename: databasename
        });
        columnlength = columnlength.data.columns.length;
    }
    catch(e){
        console.log('error retrieving columns ', e);
    }
    console.log(req_data)
    console.log(columnlength);

    //data sorting for custom columns
    let selected_columns = null;
    {   
        if (req_data.allcolumns === '*'){
            selected_columns = [];
            selected_columns.push('*');
            delete req_data.allcolumns;
        }
        else if (req_data.allcolumns === undefined ){
            for (let i = 1; i<=columnlength; i++){
                if (req_data[`column${i}`]){
                    if (selected_columns === null) 
                        selected_columns = [];
                    selected_columns.push(req_data[`column${i}`]);
                    delete req_data[`column${i}`];
                }
            }
        }
    }

    let conditions = null;
    {
            let i = 1;
            while(req_data[`columns${i}`] && req_data[`operations${i}`] && req_data[`value${i}`]){
                if (i === 1) conditions = [];
                let value=req_data[`value${i}`];
                if (value.includes(',') && req_data[`operations${i}`]==='in'){
                    value=value.split(',')
                }
                conditions.push([req_data[`columns${i}`], req_data[`operations${i}`], value]);
                i += 1;
            }
        }
        console.log(conditions)
    console.log(conditions);
    console.log(selected_columns);

    const start = process.hrtime.bigint(); // high-res start
    try{
        api_res = await axios.post(api_url + '/deleterow', {
            username: username, password: password,
            filename: filename, databasename: databasename,
            selected_columns: selected_columns, predefinedoptions: req_data.predefinedoptions,
            conditions: conditions
        });
    }
    catch(e){
        console.log('error deleting row(s) ', e);
    }
    const end = process.hrtime.bigint();   // high-res end
    const durationMs = Number(end - start) / 1e6;
    return res.redirect(`/startpage?message=${api_res.data.message}&time=Executed%20in%20${durationMs}%20ms.&filename=${filename}&databasename=${databasename}`);
});

app.post('/deletekeyvalue', async function(req, res){
    console.log(req.body);
    let api_res;
    const filename = req.body.filename, databasename = req.body.databasename;
    const req_body = req.body;
    delete req_body.filename;
    delete req_body.databasename;

    //pre sorting data
    let selected_keys = [];
    for (let key in req_body){
        if (key === 'predefinedoptions') continue
        
        if (key.startsWith('select')) selected_keys.push(req_body[key])
        else selected_keys.push(parseInt(req_body[key]))
    }

    const start = process.hrtime.bigint(); // high-res start
    try{
        api_res = await axios.post(api_url + '/deletekeyvalue', {
            username: username, password: password,
            filename: filename, databasename: databasename,
            predefinedoptions: req_body.predefinedoptions, 
            selected_keys: selected_keys
        });
    }
    catch(e){
        console.error('error retrieving key value ', e);
    }
    const end = process.hrtime.bigint();   // high-res end
    const durationMs = Number(end - start) / 1e6;
    return res.redirect(`/startpage?message=${api_res.data.message}&time=Executed%20in%20${durationMs}%20ms.&filename=${filename}&databasename=${databasename}`);
});

app.post('/querytool', async function(req, res){
    let api_res;
    let query;
    const filename = req.body.filename, databasename = req.body.databasename;
    const req_body = req.body;
    delete req_body.filename;
    delete req_body.databasename;

    const start = process.hrtime.bigint(); // high-res start

    try{
        api_res = await axios.post(api_url + '/query', {
            username: username, password: password,
            filename: filename, databasename: databasename,
            query: req_body.query
        });

    }
    catch(e){
        console.error('error sending query ', e);
    }

    const end = process.hrtime.bigint();   // high-res end
    const durationMs = Number(end - start) / 1e6;

    return res.redirect(`/startpage?message=${api_res.data.message}&time=Executed%20in%20${durationMs}%20ms.&filename=${filename}&databasename=${databasename}`);
});

app.post('/join', async function(req, res){
    let api_res, query;
    const join_type = req.query.type;
    console.log(req.body);
    const filename = req.body.filename, databasename = req.body.databasename;
    const req_body = req.body;
    delete req_body.filename;
    delete req_body.databasename;

    let primary_columns=[], secondary_columns=[], columnlength, export_table;

    
    {
        columnlength = await axios.post(api_url + '/columndetails', {
            username: username, password: password,
            filename: filename, databasename: databasename
        });

        if ('primary_all' in req_body){
            for(let column of columnlength.data.columns){
                primary_columns.push(column.name)
            }
        }
        else{
            columnlength = columnlength.data.columns.length;

            for (let i=1;i<=columnlength;i++){
                if (req_body[`primary_${i}`])
                    primary_columns.push(req_body[`primary_${i}`])
            }
        }
    }
    {
        columnlength = await axios.post(api_url + '/columndetails', {
            username: username, password: password,
            filename: req_body.table2, databasename: databasename
        });

        if ('secondary_all' in req_body){
            for(let column of columnlength.data.columns){
                secondary_columns.push(column.name)
            }
        }
        else{
            columnlength = columnlength.data.columns.length;

            for (let i=1;i<=columnlength;i++){
                if (req_body[`secondary_${i}`])
                    secondary_columns.push(req_body[`secondary_${i}`])
            }
        }
    }

    if(req_body['export_table']=='true'){
        export_table=`${req_body.tablename}.txt.json`;
    }
    else{
        export_table='null';
    }

    const start = process.hrtime.bigint(); // high-res start
    try{
        api_res = await axios.post(api_url + `/join?type=${join_type}`, {
            username: username, password: password,
            filename: filename, databasename: databasename,
            key1:req_body.key1, primary_columns:primary_columns,
            table2: req_body.table2, key2: req_body.key2, secondary_columns: secondary_columns,
            export_table: export_table
        });
        query = encodeURIComponent(JSON.stringify(api_res.data));
        console.log(api_res.data);
    }
    catch(e){
        console.error('error joining tables ', e);
    }
    const end = process.hrtime.bigint();   // high-res end
    const durationMs = Number(end - start) / 1e6;
    return res.redirect(`/startpage?message=${api_res.data.message}&time=Executed%20in%20${durationMs}%20ms.&filename=${filename}&databasename=${databasename}&extradata=${query}`);
});

app.post('/split', async function(req, res){
    let api_res;
    const split_type = req.query.type;
    console.log(req.body);
    const filename = req.body.filename, databasename = req.body.databasename;
    const req_body = req.body;
    delete req_body.filename;
    delete req_body.databasename;
    let new_columns = null, conditions = null;
    if (split_type === 'verticalsplit'){
        new_columns = [];
        for (let key in req_body){
            if(key!=='new_table_name'){
                new_columns.push(req_body[key])
            }
        }
        console.log(new_columns)
    }
    else if (split_type === 'horizontalsplit'){
        
        let columnlength;
        try{
            columnlength = await axios.post(api_url + '/columndetails', {
                username: username, password: password,
                filename: filename, databasename: databasename
            });
            columnlength = columnlength.data.columns.length;
        }
        catch(e){
            console.log('error retrieving columns ', e);
        }

        //data sorting for custom columns

        
        {
            let i = 1;
            while(req_body[`columns${i}`] && req_body[`operations${i}`] && req_body[`value${i}`]){
                if (i === 1) conditions = [];
                let value=req_body[`value${i}`];
                if (value.includes(',') && req_body[`operations${i}`]==='in'){
                    value=value.split(',')
                }
                conditions.push([req_body[`columns${i}`], req_body[`operations${i}`], value]);
                i += 1;
            }
        }
        console.log(conditions)
    }

    const start = process.hrtime.bigint(); // high-res start
    try{
        api_res = await axios.post(api_url + `/split?type=${split_type}`, {
            username: username, password: password,
            filename: filename, databasename: databasename,
            new_table_name: req_body.new_table_name, 
            new_columns: new_columns, conditions: conditions
        });
    }
    catch(e){
        console.error('error splitting tables ', e);
    }
    const end = process.hrtime.bigint();   // high-res end
    const durationMs = Number(end - start) / 1e6;
    return res.redirect(`/startpage?message=${api_res.data.message}&time=Executed%20in%20${durationMs}%20ms.`);
});

app.post('/sort', async function(req, res){
    console.log(req.body);
    let api_res, export_table;
    const req_data = req.body;
    const filename = req.body.filename, databasename = req.body.databasename, sortingkey = req_data.sortingkey.split('_')[0], sortingorder = req_data.sortingorder;
    delete req_data.filename;
    delete req_data.databasename;
    delete req_data.sorting

    let columnlength;
    try{
        columnlength = await axios.post(api_url + '/columndetails', {
            username: username, password: password,
            filename: filename, databasename: databasename
        });
        columnlength = columnlength.data.columns.length;
    }
    catch(e){
        console.log('error retrieving columns ', e);
    }

    //data sorting for columns
    let selected_columns = null;
    {   
        if (req_data.allcolumns === '*'){
            selected_columns = [];
            selected_columns.push('*');
            delete req_data.allcolumns;
        }
        else if (req_data.allcolumns === undefined ){
            for (let i = 1; i<=columnlength; i++){
                if (req_data[`column${i}`]){
                    if (selected_columns === null) 
                        selected_columns = [];
                    selected_columns.push(req_data[`column${i}`]);
                    delete req_data[`column${i}`];
                }
            }
        }
    }

    if(req_data['export_table']=='true'){
        export_table=`${req_data.tablename}.txt.json`;
    }
    else{
        export_table='null';
    }

    let query = null;

    const start = process.hrtime.bigint(); // high-res start
    try{
        api_res = await axios.post(api_url + '/sort', {
            username: username, password: password,
            filename: filename, databasename: databasename,
            selected_columns: selected_columns, sortingkey: sortingkey, sortingorder: sortingorder,
            export_table: export_table
        });
        // console.log(api_res.data);
        query = encodeURIComponent(JSON.stringify(api_res.data));
        console.log(api_res.data);
    }
    catch(e){
        console.log('error retrieving row ', e);
        console.log(api_res.data.message);
    }
    const end = process.hrtime.bigint();   // high-res end
    const durationMs = Number(end - start) / 1e6;
    return res.redirect(`/startpage?message=${api_res.data.message}&time=Executed%20in%20${durationMs}%20ms.&filename=${filename}&databasename=${databasename}&extradata=${query}`);
});

app.post('/visualizedata', async function(req, res){
    console.log(req.body);
    let userSelection = req.body, response;

    let filename = req.body.filename, databasename = req.body.databasename;

    delete userSelection.filename;
    delete userSelection.databasename;
    try{
            let api_res = await axios.post(api_url + '/columndetails', {username : username, password: password, filename: filename, databasename: databasename});
            api_res=api_res.data;
            api_res['chartType']=req.body.chartType;
            api_res['categoryX']=req.body.category_x;
            api_res['valueY']=req.body.value_y;
            api_res['groupBy']=req.body.group_by;
            
            let rows = api_res.rows;
            let columns = api_res.columns;

            let prompt = `
                You are a senior data analyst.

                IMPORTANT:
                Respond using the following EXACT section markers.
                Do not rename them.

                [KEY_TRENDS]
                - '*' Bullet points only

                [ANOMALIES]
                - '*' Bullet points only

                [PREDICTIONS]
                - '*' Bullet points only

                [RECOMMENDATIONS]
                - '*' Bullet points only

                Dataset columns:
                ${columns.map(c => `${c.name} (${c.type})`).join(', ')}

                Sample data:
                ${JSON.stringify(rows.slice(0, 10), null, 2)}

                User visualization intent:
                ${JSON.stringify(userSelection)}
                `;


            try {
                response = await groq.chat.completions.create({
                model: "meta-llama/llama-4-scout-17b-16e-instruct",   // 🔥 best for analytics
                messages: [
                    { role: "user", content: prompt }
                ],
                temperature: 0.3
                });

                // res.json({
                // insights: response.choices[0].message.content
                // });
                console.log(response.choices[0].message.content);

            } catch (err) {
                console.error(err);
                res.status(500).json({ error: "AI analysis failed" });
            }

            api_res['aidata']=response.choices[0].message.content;
            console.log(api_res)
            let query = encodeURIComponent(JSON.stringify(api_res));
            
            return res.redirect(`/startpage?choice=visualizedataresult&filename=${filename}&databasename=${databasename}&data=${query}`);
        }
        catch(e){
            console.error('error retrieving file columnar details', e)
        }
});

app.post('/find', async function(req, res){
    let api_res;
    console.log(req.body);
    const req_body = req.body;
    const start = process.hrtime.bigint(); // high-res start
    try{
        api_res = await axios.post(api_url + '/find', {
            username: username, password: password,
            filename: req_body.filename, databasename: req_body.databasename,
            findType: req_body.findType, keyName: req_body.keyname,
            matchType: req_body.matchtype, valueName: req_body.valuename,
            valueType: req_body.valuetype, operator: req_body.operator
        });
        console.log(api_res.data)
        const end = process.hrtime.bigint();   // high-res end
        const durationMs = Number(end - start) / 1e6;
        return res.redirect(`/startpage?message=${api_res.data.message}&time=Executed%20in%20${durationMs}%20ms.&filename=${req_body.filename}&databasename=${req_body.databasename}`);
    }
    catch(e){
        console.error('error retrieving key value ', e);
        return res.redirect('/startpage?message=key-value selection unsuccessful');
    }
});

app.post('/changeschema', async function(req, res){
    const req_body = req.body, filename = req.body.filename, databasename = req.body.databasename;
    let api_res, i=1;
    console.log(req_body)

    let constraints = [], derivatives = [], column_names = [], column_types = [];

    let columnlength;
    try{
        columnlength = await axios.post(api_url + '/columndetails', {
            username: username, password: password,
            filename: filename, databasename: databasename
        });
        columnlength = columnlength.data.columns;
    }
    catch(e){
        console.log('error retrieving columns ', e);
    }

    if (req_body.changeschemaType === 'addcolumn'){
        let i=1;

        while(Object.keys(req_body).some(key => key.startsWith('columnname'))){
            let temp = []
            if (!(`columnname${i}` in req_body)){
                i++;
                continue;
            } 
            column_names.push(req_body[`columnname${i}`]);
            delete req_body[`columnname${i}`];

            column_types.push(req_body[`columntype${i}`]);
            if (req_body[`notnull${i}`] === 'on') temp.push('not_null')
            if (req_body[`primarykey${i}`] === 'on') temp.push('primary_key')
            if (req_body[`unique${i}`] === 'on') temp.push('unique')
            if (req_body[`serial${i}`] === 'on') temp.push('serial')
            constraints.push(temp)
            if (`derivativeinfo${i}` in req_body) derivatives.push(req_body[`derivativeinfo${i}`])
            i++
        }
    }
    else if (req_body.changeschemaType === 'removecolumn'){
        if ('allcolumns' in req_body) columnlength.forEach(c => {column_names.push(c.name)});
        else{
            let i=1;
            for (let i = 1; i<=columnlength.length; i++){
                if (req_body[`column${i}`]){
                    column_names.push(req_body[`column${i++}`]);
                }
            }
        }
    }
    else if (req_body.changeschemaType === 'changecolumnname'){
        let i=1;
        while(`column${i}` in req_body){
            column_names.push(req_body[`column${i}`]);
            i++
        }
    }
    else if (req_body.changeschemaType === 'changecolumntype'){
        let i=1;
        while(`column${i}` in req_body){
            let temp = []
            column_types.push(req_body[`column${i}`]);
            if (`derivativeinfo${i}` in req_body) derivatives.push(req_body[`derivtiveinfo${i}`]==='' ? '': req_body[`derivativeinfo${i}`])
            i++
        }
        // derivatives.push(...req_body.derivativeinfo);
    }
    else if (req_body.changeschemaType === 'changecolumnconstraints'){
        let i=1;
        for (let i = 1; i<=columnlength.length; i++){
            let temp = []
            if (req_body[`notnull${i}`] === 'on') temp.push('not_null')
            if (req_body[`primarykey${i}`] === 'on') temp.push('primary_key')
            if (req_body[`unique${i}`] === 'on') temp.push('unique')
            if (req_body[`serial${i}`] === 'on') temp.push('serial')
            constraints.push(temp)
        }
    }
    else if (req_body.changeschemaType === 'customchange'){
        let i=1;

        while(Object.keys(req_body).some(key => key.startsWith('columnname'))){
            let temp = []
            if (!(`columnname${i}` in req_body)){
                i++;
                continue;
            } 
            column_names.push(req_body[`columnname${i}`]);
            delete req_body[`columnname${i}`];

            column_types.push(req_body[`columntype${i}`]);
            if (req_body[`notnull${i}`] === 'on') temp.push('not_null')
            if (req_body[`primarykey${i}`] === 'on') temp.push('primary_key')
            if (req_body[`unique${i}`] === 'on') temp.push('unique')
            if (req_body[`serial${i}`] === 'on') temp.push('serial')
            constraints.push(temp)
            if (`derivativeinfo${i}` in req_body) derivatives.push(req_body[`derivativeinfo${i}`])
            i++
        }
        console.log(constraints, derivatives, column_names, column_types)
        
        //file updation done via /insertrow
        const start = process.hrtime.bigint(); // high-res start
        let file_data;
        try{
            file_data = await axios.post(api_url + '/columndetails', {
                username: username, password: password,
                filename: filename, databasename: databasename
            });
            file_data = file_data.data;
        }
        catch(e){
            console.log('error retrieving file data ', e);
        }

        let temp_file_data = {
                "filetype": "table",
                "rows": [],
                "columns": []
            };

            for (let i=0; i<column_names.length; i++){
                let column = {};
                column['name'] = column_names[i];
                column['type'] = column_types[i];
                column['expression'] = derivatives[i];
                column['constraints'] = constraints[i];
                temp_file_data.columns.push(column);
            }

            let temp_api_res = await axios.post(api_url + '/temp_file_writer', {
                username: username, password: password,
                filename: filename, databasename: databasename,
                file_data: temp_file_data
            });
            

            api_res = await axios.post(api_url + '/insertrow', {
                username: username, password: password,
                filename: filename, databasename: databasename,
                rows: file_data.rows
            });
            console.log(api_res.data.message)
            if (api_res.data.message !== 'Insertion Successful'){
                api_res.data.message = `Table Schema Change Unsuccessful. ${api_res.data.message}`;
                temp_api_res = await axios.post(api_url + '/temp_file_writer', {
                    username: username, password: password,
                    filename: filename, databasename: databasename,
                    file_data: file_data
                });
            }
            else{
                api_res.data.message = "Table Schema Change Successful";
            }
            const end = process.hrtime.bigint();   // high-res end
            const durationMs = Number(end - start) / 1e6;
            return res.redirect(`/startpage?message=${api_res.data.message}&time=Executed%20in%20${durationMs}%20ms.`);
    }

    console.log(constraints, derivatives, column_names, column_types)
    const start = process.hrtime.bigint(); // high-res start
    
    try{
        api_res = await axios.post(api_url + '/changeschema', {username : username, password: password,
            databasename: databasename, filename: filename, changeschemaType: req_body.changeschemaType,
            column_names: column_names, column_types: column_types,
            derivatives: derivatives, constraints: constraints});
        console.log(api_res.data.message);
    }
    catch(e){
        console.error('error changing schema ', e);
    }

    const end = process.hrtime.bigint();   // high-res end
    const durationMs = Number(end - start) / 1e6;
    return res.redirect(`/startpage?message=${api_res.data.message}&time=Executed%20in%20${durationMs}%20ms.`);

});

// app.post('/import',upload.single('file'), async function(req, res){

//     const req_body = req.body, file_data = req.file.buffer.toString('utf-8');
//     let api_res, i=1, Message = 'Import Successful';

//     const start = process.hrtime.bigint(); // high-res start

//     let constraints = [], headers = [];
//     req_body[`derivativeinfo`] = [];
//     while(`columnname${i}` in req_body && `columntype${i}` in req_body){
//         headers.push(req_body[`columnname${i}`]);
//         req_body[`derivativeinfo`].push('');
//         let temp = []
//         if (req_body[`notnull${i}`] === 'on') temp.push('not_null')
//         if (req_body[`primarykey${i}`] === 'on') temp.push('primary_key')
//         if (req_body[`unique${i}`] === 'on') temp.push('unique')
//         if (req_body[`serial${i}`] === 'on') temp.push('serial')
//         constraints.push(temp)
//         i++
//     }
//     try{
//         api_res = await axios.post(api_url + '/newfile', {username : username, password: password, file_details : req_body, constraints: constraints});
//         console.log(api_res.data.message);
//     }
//     catch(e){
//         console.error('error creating new file ', e);
//     }

    
//     let rows = Papa.parse(file_data, {
//     header: false,
//     skipEmptyLines: true
//     }).data;

//     let mappedRows = rows.map(row => {
//         let obj = {};
//         headers.forEach((h, i) => {
//             obj[h] = row[i] ?? null;
//         });
//         return obj;
//     });

//     // console.log(mappedRows)
//     mappedRows.splice(0, 1);


//     //inserting data
//     if (req_body.filetypeselect === 'table'){
//         try{
//             api_res = await axios.post(api_url + '/insertrow', {
//                 username: username, password: password,
//                 filename: `${req_body.filename}.txt.json`, databasename: req_body.databaseselect,
//                 rows: mappedRows});
//             console.log(api_res.data.message);
//             if (!api_res.data.message.includes('Insertion Successful')) Message = 'Import Failed'
            
//         }
//         catch(e){
//             console.log('error inserting row ', e);
//             console.log(api_res.data.message);
//         }
//     }
//     else if (req_body.filetypeselect === 'json'){}

//     const end = process.hrtime.bigint();   // high-res end
//     const durationMs = Number(end - start) / 1e6;
//     console.log(Message)
//     return res.redirect(`/startpage?message=${Message}&time=Executed%20in%20${durationMs}%20ms.`);
// });

app.post('/import', upload.single('file'), async function(req, res){
    const req_body = req.body, file_data = req.file.buffer.toString('utf-8');
    let api_res, i=1;

    const start = process.hrtime.bigint();

    let constraints = [], headers = [];
    req_body[`derivativeinfo`] = [];
    while(`columnname${i}` in req_body && `columntype${i}` in req_body){
        headers.push(req_body[`columnname${i}`]);
        req_body[`derivativeinfo`].push('');
        let temp = []
        if (req_body[`notnull${i}`] === 'on') temp.push('not_null')
        if (req_body[`primarykey${i}`] === 'on') temp.push('primary_key')
        if (req_body[`unique${i}`] === 'on') temp.push('unique')
        if (req_body[`serial${i}`] === 'on') temp.push('serial')
        constraints.push(temp)
        i++
    }
    
    try{
        api_res = await axios.post(api_url + '/newfile', {
            username : username, 
            password: password, 
            file_details : req_body, 
            constraints: constraints
        });
        console.log(api_res.data.message);
    }
    catch(e){
        console.error('error creating new file ', e);
        const end = process.hrtime.bigint();
        const durationMs = Number(end - start) / 1e6;
        return res.redirect(`/startpage?message=File%20creation%20failed&time=Executed%20in%20${durationMs}%20ms.`);
    }

    let rows = Papa.parse(file_data, {
        header: false,
        skipEmptyLines: true
    }).data;

    // let mappedRows = rows.map(row => {
    //     let obj = {};
    //     headers.forEach((h, i) => {
    //         obj[h] = row[i] ?? null;
    //     });
    //     return obj;
    // });

    if (req_body.filetypeselect === 'table'){
        let mappedRows = rows.map(row => {
        let obj = {};
        headers.forEach((h, i) => {
            obj[h] = row[i] ?? null;
        });
        return obj;
    });

    mappedRows.splice(0, 1); // Remove header row
    
    const BATCH_SIZE = 50;
    let totalInserted = 0;
    let allSuccessful = true;

    for (let i = 0; i < mappedRows.length; i += BATCH_SIZE) {
        const batch = mappedRows.slice(i, i + BATCH_SIZE);
        
        try{
            api_res = await axios.post(api_url + '/insertrow', {
                username: username, 
                password: password,
                filename: `${req_body.filename}.txt.json`, 
                databasename: req_body.databaseselect,
                rows: batch
            }, {
                timeout: 30000
            });
            
            console.log(`Batch ${Math.floor(i/BATCH_SIZE) + 1}: ${api_res.data.message}`);
            
            if (api_res.data.message.includes('Insertion Successful')) {
                totalInserted += batch.length;
                
                // Add delay between batches to let server recover
                if (i + BATCH_SIZE < mappedRows.length) {
                    await new Promise(resolve => setTimeout(resolve, 500)); // 500ms delay
                }
            } else {
                allSuccessful = false;
                break;
            }
        }
        catch(e){
            console.error(`Error inserting batch at row ${i}:`, e.message);
            allSuccessful = false;
            break;
        }
    }

    const end = process.hrtime.bigint();
    const durationMs = Number(end - start) / 1e6;
    
    const message = allSuccessful 
        ? `Successfully imported ${totalInserted} rows`
        : `Partial import: ${totalInserted} of ${mappedRows.length} rows inserted`;
    
    return res.redirect(`/startpage?message=${encodeURIComponent(message)}&time=Executed%20in%20${durationMs.toFixed(2)}%20ms.`);
    }
    else if (req_body.filetypeselect === 'json'){
         const csvHeaders = rows[0]; // First row of CSV
    const dataRows = rows.slice(1); // Skip header row
    
    let mappedRows = dataRows.map(row => {
        let obj = {};
        csvHeaders.forEach((h, i) => {
            obj[h] = row[i] ?? null;
        });
        return obj;
    });
        mappedRows.splice(0, 1); // Remove header row
        
        const BATCH_SIZE = 50;
        let totalInserted = 0;
        let allSuccessful = true;
        
        for (let i = 0; i < mappedRows.length; i += BATCH_SIZE) {
            const batch = mappedRows.slice(i, i + BATCH_SIZE);
            const keyvalues = { clashbehaviour: req_body.clashbehaviour || 'merge' }; // Use 'append' to add to array
            
            // Store entire batch as array under 'data' key
            keyvalues[`key_1`] = 'data';
            keyvalues[`value_1`] = JSON.stringify(batch); // Batch is already an array of objects
            
            try {
                api_res = await axios.post(api_url + '/insertkeyvalue', {
                    username: username,
                    password: password,
                    filename: `${req_body.filename}.json`,
                    databasename: req_body.databaseselect,
                    keyvalues: keyvalues
                }, {
                    timeout: 30000
                });
                
                console.log(`Batch ${Math.floor(i/BATCH_SIZE) + 1}: ${api_res.data.message}`);
                
                if (api_res.data.message.includes('Insertion successful')) {
                    totalInserted += batch.length;
                    
                    if (i + BATCH_SIZE < mappedRows.length) {
                        await new Promise(resolve => setTimeout(resolve, 500));
                    }
                } else {
                    allSuccessful = false;
                    break;
                }
            } catch(e) {
                console.error(`Error inserting batch at row ${i}:`, e.message);
                allSuccessful = false;
                break;
            }
        }
        
        const end = process.hrtime.bigint();
        const durationMs = Number(end - start) / 1e6;
        
        const message = allSuccessful 
            ? `Successfully imported ${totalInserted} records`
            : `Partial import: ${totalInserted} of ${mappedRows.length} records inserted`;
        
        return res.redirect(`/startpage?message=${encodeURIComponent(message)}&time=Executed%20in%20${durationMs.toFixed(2)}%20ms.`);
    }
});

app.post('/export',async function(req, res) {
    let data = req.body, api_res;
    console.log(data);
    try{
        api_res = await axios.post(api_url + '/filedetails', {
            username: username, password: password,
            filename: data.file, databasename: data.database
        });
        api_res = api_res.data;
        api_res['filetype'] = data.file.endsWith('.txt.json') ? 'table' : 'json';
        console.log(api_res);
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${data.file}"`);
        
        // Send the content directly
        res.send(JSON.stringify(api_res, null, 2));
    }
    catch(e){
        console.log('error retrieving file details ', e);
    }
});

app.listen(port, function(){
    console.log(`server is running on port ${port}`);
});