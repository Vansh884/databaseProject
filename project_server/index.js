import express from 'express';
import { dirname, parse } from 'path';
import fs from 'fs/promises';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import axios from 'axios';
import bcrypt from 'bcrypt';
import cors from "cors";
//hi

// const port = 4000;
const port = process.env.PORT || 4000;
const app = express();
const __dirname = dirname(fileURLToPath(import.meta.url));
const api_url = 'http://localhost:4000';
const filepath = path.join(__dirname, '/meta_json/authentication.json');
const salt_rounds = 10;

app.use(cors({
  origin: "*"
}));


app.set('view engine', 'ejs');

app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

//derivative

function extractColumnDependencies(expression, knownFunctions = ['IF']) {
  // 1️⃣ Remove string literals ("..." or '...')
  if (expression === '') return;
  const withoutStrings = expression.replace(
    /"(?:\\.|[^"])*"|'(?:\\.|[^'])*'/g,
    ''
  );

  // 2️⃣ Extract identifiers
  const tokens = withoutStrings.match(/[A-Za-z_][A-Za-z0-9_]*/g) || [];

  const deps = new Set();

  tokens.forEach(t => {
    // ignore functions
    if (knownFunctions.includes(t)) return;

    // ignore keywords
    if (['true', 'false', 'null'].includes(t.toLowerCase())) return;

    deps.add(t);
  });

  return [...deps];
}

//helpers
function isAllLower(str) {
  return str === str.toLowerCase() && /[a-z]/.test(str);
}


function tokenize(expr) {
        return expr.match(
            /"(?:\\.|[^"])*"|[A-Za-z_]\w*|\d+\.\d+|\d+|==|!=|>=|<=|&&|\|\||[(),+\-*/%<>!]/g
        );
}

function buildFunctionContext() {
  return {
    IF: (cond, a, b) => cond ? a : b
  };
}

function evaluateExpression(tokens, row, funcs) {
  let i = 0;

  const peek = () => tokens[i];
  const next = () => tokens[i++];

  function parsePrimary() {
    const t = next();

    if (t === '(') {
      const v = parseLogical();
      if (next() !== ')') throw 'Expected )';
      return v;
    }

    if (t === '!') return !parsePrimary();

    if (!isNaN(t)) return Number(t);

    if (t.startsWith('"')) return t.slice(1, -1);

    if (funcs[t]) {
      if (next() !== '(') throw 'Expected (';
      const c = parseLogical();
      if (next() !== ',') throw 'Expected ,';
      const a = parseLogical();
      if (next() !== ',') throw 'Expected ,';
      const b = parseLogical();
      if (next() !== ')') throw 'Expected )';
      return funcs[t](c, a, b);
    }

    if (row[t] !== undefined) return row[t];

    throw `Unknown identifier: ${t}`;
  }

  function parseMulDiv() {
    let v = parsePrimary();
    while (['*','/','%'].includes(peek())) {
      const op = next();
      const r = parsePrimary();
      v = op === '*' ? v * r : op === '/' ? v / r : v % r;
    }
    return v;
  }

  function parseAddSub() {
    let v = parseMulDiv();
    while (['+','-'].includes(peek())) {
      const op = next();
      const r = parseMulDiv();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }

  function parseCompare() {
    let v = parseAddSub();
    while (['==','!=','>','<','>=','<='].includes(peek())) {
      const op = next();
      const r = parseAddSub();
      if (op === '==') v = v == r;
      if (op === '!=') v = v != r;
      if (op === '>')  v = v > r;
      if (op === '<')  v = v < r;
      if (op === '>=') v = v >= r;
      if (op === '<=') v = v <= r;
    }
    return v;
  }

  function parseLogical() {
    let v = parseCompare();
    while (['&&','||'].includes(peek())) {
      const op = next();
      const r = parseCompare();
      v = op === '&&' ? v && r : v || r;
    }
    return v;
  }

  return parseLogical();
}

function evaluateDerivedColumn(expression, currentRow) {
  const tokens = tokenize(expression);
  const funcs = buildFunctionContext();

  return evaluateExpression(tokens, currentRow, funcs);
}

async function check_authentication(details){
    let data = null;
    try{
        data = await fs.readFile(filepath, 'utf-8');
        data = JSON.parse(data);
        for (let line of data){
            console.log(line);
            if (line.username === details.username){
                const match = await bcrypt.compare(details.password, line.password);
                if (match){
                    line['previous_login']=line['last_logged_in'];
                    line['last_logged_in']=new Date().toISOString();
                    await fs.writeFile(filepath, JSON.stringify(data, null, 2));
                    return 1;
                } 
                else return 0;
            }
        }
        
    }
    catch(e){
        console.error('error reading json ', e);
    }
    return 0;
}

async function enter_new_user(details){
    
    let data = null;
    bcrypt.hash(details.password, salt_rounds, async function(err, hash){
        
        if (err) console.error('error hashing passwords ', err);

        details.password = hash; //replacing actual password with hash
        try{
            data = await fs.readFile(filepath, 'utf-8');
            data = JSON.parse(data);
            details['last_logged_in']=new Date().toISOString();
            details['credits'] = 0;
            data.push(details);
            try{
                await fs.writeFile(filepath, JSON.stringify(data, null, 2));
                console.log('new user added successfully !');
            }
            catch(e){
                console.error('error writing json ', e);
            }
        }
        catch(e){
            console.error('error reading json ', e);
        }
    });
}

async function show_in_folder(name){
    try{
        const files = await fs.readdir(__dirname + name);
        return files;
    }
    catch(e){
        console.error('error reading folder ', e);
        return [];
    }
}
async function smartSplit(str) {
  let result = [];
  let current = '';
  let bracketDepth = 0; // for []
  let braceDepth = 0;   // for {}
  let inString = false; // for ignoring commas inside quotes

  for (let ch of str) {
    if (ch === '"' && current[current.length - 1] !== '\\') {
      inString = !inString;
    }

    if (!inString) {
      if (ch === '[') bracketDepth++;
      else if (ch === ']') bracketDepth--;
      else if (ch === '{') braceDepth++;
      else if (ch === '}') braceDepth--;
    }

    if (ch === ',' && bracketDepth === 0 && braceDepth === 0 && !inString) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }

  if (current.trim()) result.push(current.trim());

  console.log(result);
  return result;
}

async function splitQuerySafely(query) {
    query = query.trim();

    let parts = [];
    let current = '';
    let insideBrackets = false;

    for (let i = 0; i < query.length; i++) {
        const ch = query[i];

        if (ch === '[') insideBrackets = true;
        if (ch === ']') insideBrackets = false;

        // Split only when outside brackets
        if (ch === ' ' && !insideBrackets) {
            if (current.length > 0) {
                parts.push(current);
                current = '';
            }
        } else {
            current += ch;
        }
    }

    if (current.length > 0) parts.push(current);

    // remove trailing semicolon from last part if present
    if (parts.length > 0 && parts[parts.length - 1].endsWith(';')) {
        parts[parts.length - 1] = parts[parts.length - 1].slice(0, -1);
    }

    return parts;
}

async function parse_query(query, username, password, databasename, filename){
    let message = 'Error Executing Query';
    try{
        let api_res;
        query = query.split(";");
        if (query.length === 0 || (query.length === 1 && query[0].trim() === '')) {
            throw new Error();
        }

        for (let i = 0; i < query.length; i++){
            query[i] = query[i].replace("\r", "").replace("\n", "");
            query[i] = await splitQuerySafely(query[i]);
        }
        query.pop();
        console.log(query);

        for (let q of query){
            if (isAllLower(q[0]) === false){
                message = `"${q[0]}" Should Be In LowerCase`;
                throw new Error();
            }
            if (q[0] === 'delete'){
                if (!(q[1].toLowerCase() === 'file' || q[1].toLowerCase() === 'database' || (q[1].includes('[') && q[1].includes(']')))){
                    message =  `Unrecognized Symbol "${q[1]}"`;
                    throw new Error;
                }

                if (q[1] === 'database'){
                    try{
                        api_res = await axios.post(api_url + '/deletedatabase', {username : username, password: password, database : q[2]});
                        console.log(api_res.data.message);
                        return api_res.data;
                    }
                    catch(e){
                        console.error('error deleting database ', e);
                        return api_res.data.message;
                    }
                }
                if (q[1] === 'file'){
                    if (!isAllLower(q[2])){
                        message = `"${q[2]}" Should Be In LowerCase`;
                        throw new Error();
                    }
                    if (!(q[2] === 'table' || q[2] === 'json')){
                        message = `"${q[2]}" Is Not A Valid File Type`;
                        throw new Error();
                    }

                    let file = q[2] === 'table' ? `${q[3]}.txt.json` : `${q[3]}.json`;

                    try{
                        api_res = await axios.post(api_url + '/deletefile', {username : username, password: password, database : databasename, file: file});
                        console.log(api_res.data.message);
                        return api_res.data;
                    }
                    catch(e){
                        console.error('error deleting file ', e);
                        return api_res.data.message;
                    }
                }
                else{
                    //syntax error check
                    {
                        if (!(q[1].includes('[') && q[1].includes(']'))){
                            message = `Key Specification Lack []`;
                            throw new Error();
                        }
                    }
                    let predefinedoptions = 'none', selected_keys = ['none'];
                    if (q[1]){
                        let pair = q[1].slice(1, -1);
                        if (pair === 'allkeys') predefinedoptions = 'allkeys';
                        else if (pair === 'first10') predefinedoptions = 'first10';
                        else if (pair === 'last10') predefinedoptions = 'last10';
                        else{
                            selected_keys.splice(0, 1);
                            let temp = pair.split(".");
                            
                            // Process each part to handle array indices
                            for (let part of temp) {
                                if (part.includes("[") && part.includes("]")) {
                                    // Split by '[' to separate key and indices
                                    let parts = part.split("[");
                                    
                                    // Add the key name
                                    selected_keys.push(parts[0]);
                                    
                                    // Add all array indices
                                    for (let j = 1; j < parts.length; j++) {
                                        let index = parseInt(parts[j].replace("]", ""));
                                        selected_keys.push(index);
                                    }
                                } else {
                                    // Regular key without array index
                                    selected_keys.push(part);
                                }
                            }
                        }
                        console.log(predefinedoptions);
                        console.log(selected_keys);
                    }
                    
                    try{
                        api_res = await axios.post(api_url + '/deletekeyvalue', {
                            username: username, password: password,
                            filename: filename, databasename: databasename,
                            predefinedoptions: predefinedoptions, selected_keys: selected_keys
                        });
                        return api_res.data;
                    }
                    catch(e){
                        console.log('error retrieving key-value ', e);
                        return api_res.data.message;
                    }
                }
                
            }
            else if (q[0] === 'update'){
    //syntax error check
    {
        if (!(q[1].includes('[') && q[1].includes(']'))){
            message = `Key Specification Lack []`;
            throw new Error();
        }

        if (q[2]!=='to'){
            message =  `Unrecognized Symbol "${q[2]}". "to" Keyword Missing`;
            throw new Error();
        }

        if (!(q[3].includes('[') && q[3].includes(']'))){
            message = `Value Specification Lack []`;
            throw new Error();
        }
    }
    let selected_keys = [], update_value = '';
    if (q[1]){
        let pair = q[1].slice(1, -1);
        let temp = pair.split(".");
        
        // Process each part to handle array indices
        for (let part of temp) {
            if (part.includes("[") && part.includes("]")) {
                // Split by '[' to separate key and indices
                let parts = part.split("[");
                
                // Add the key name
                selected_keys.push(parts[0]);
                
                // Add all array indices
                for (let j = 1; j < parts.length; j++) {
                    let index = parseInt(parts[j].replace("]", ""));
                    selected_keys.push(index);
                }
            } else {
                // Regular key without array index
                selected_keys.push(part);
            }
        }
    }
    if (q[2] === 'to' && q[3]){
        update_value = q[3].slice(1, -1);
    }
    console.log(selected_keys, update_value);
    try{
        api_res = await axios.post(api_url + '/updatekeyvalue', {
            username: username, password: password,
            filename: filename, databasename: databasename,
            selected_keys: selected_keys, update_value: update_value
        });
        return api_res.data;
    }
    catch(e){
        console.log('error updating key-value ', e);
        return api_res.data.message;
    }
            }
            else if (q[0] === 'select'){
                //syntax error check
                {
                    if (!(q[1].includes('[') && q[1].includes(']'))){
                        message = `Key Specification Lack []`;
                        throw new Error();
                    }
                }

                let predefinedoptions = 'none', selected_keys = ['none'];
                if (q[1]){
                    let pair = q[1].slice(1, -1);
                    if (pair === 'allkeys') predefinedoptions = 'allkeys';
                    else if (pair === 'first10') predefinedoptions = 'first10';
                    else if (pair === 'last10') predefinedoptions = 'last10';
                    else{
                        selected_keys.splice(0, 1);
                        let temp = pair.split(".");
                        
                        // Process each part to extract keys and array indices
                        for (let i = 0; i < temp.length; i++){
                            let part = temp[i];
                            
                            // Check if this part contains array indices like 'key[0]' or 'key[0][1]'
                            if (part.includes("[") && part.includes("]")){
                                // Extract key and all indices
                                // Example: 'bh[3][5]' becomes ['bh', '3]', '5]']
                                let parts = part.split("[");
                                
                                // First part is the key
                                selected_keys.push(parts[0]);
                                
                                // Remaining parts are indices
                                for (let j = 1; j < parts.length; j++){
                                    let index = parseInt(parts[j].replace("]", ""));
                                    selected_keys.push(index);
                                }
                            } else {
                                // Regular key without array index
                                selected_keys.push(part);
                            }
                        }
                    }
                    console.log(predefinedoptions);
                    console.log(selected_keys);
                }
                
                try{
                    api_res = await axios.post(api_url + '/selectkeyvalue', {
                        username: username, password: password,
                        filename: filename, databasename: databasename,
                        predefinedoptions: predefinedoptions, selected_keys: selected_keys
                    });
                    return api_res.data;
                }
                catch(e){
                    console.log('error retrieving key-value ', e);
                    return api_res.data.message;
                }
            }
            else if (q[0] === 'insert'){
                //syntax error check
                {
                    if (!(q[1].includes('[') && q[1].includes(']'))){
                        message = `Key-Value Specification Lack []`;
                        throw new Error();
                    }

                    if (q[2]!=='where'){
                        message =  `Unrecognized Symbol "${q[2]}". "where" Keyword Missing`;
                        throw new Error();
                    }

                    if (!(q[3]==='replace' || q[3]==='append' || q[3]==='merge' || q[3]==='ignore')){
                        message = `"${q[3]}" Is Not A Valid Clash Behaviour Type`;
                        throw new Error();
                    }
                }

                let keyvalues = {"clashbehaviour": "replace"};
                if (q[1]){
                    let i = 1;
                    let pair = await smartSplit(q[1].slice(1, -1));
                    for (let p of pair){
                        keyvalues[`key_${i}`] = p.split("=")[0];
                        keyvalues[`value_${i++}`] = p.split("=")[1];
                    }
                }
                if (q[2] === 'where' && (q[3]==='replace' || q[3]==='merge' || q[3]==='append' || q[3]==='ignore')){
                    keyvalues['clashbehaviour'] = q[3];
                }

                try{
                    api_res = await axios.post(api_url + '/insertkeyvalue', {
                        username: username, password: password,
                        filename: filename, databasename: databasename,
                        keyvalues: keyvalues
                    });
                    return api_res.data;
                }
                catch(e){
                    console.log('error inserting key-value ', e);
                    return api_res.data.message;
                }
            }
            else if (q[0] === 'get'){
                let temp_res = {};
                let selected_columns = []
                let conditions = null;

                //syntax error check
                {
                    if (!(q[1].includes('[') && q[1].includes(']'))){
                        message = `Column Specification Lack []`;
                        throw new Error();
                    }
                }

                //remember we will never go for predefined options..always custom options
                if (q[1].includes("all")){
                    selected_columns.push('*');
                }
                else{
                    // for converting the string of column names into an array
                    selected_columns = q[1].split(",");
                    selected_columns.forEach((x, i) => {
                        selected_columns[i] = x.replace("[", "").replace("]", "");
                    });
                }

                if (q[2] === 'if' && q[3]){

                    if (!(q[3].includes('[') && q[3].includes(']'))){
                        message = `Condition Specification Lack []`;
                        throw new Error();
                    }

                    conditions = [];
                    let cns = q[3].split(",");
                    cns.forEach((x, i) => {
                        cns[i] = x.replace("[", "").replace("]", "");
                    });
                    for (let condition of cns){
                        let temp = [];

                        if (condition.includes('(') === true && condition.includes(')') === true){
                            temp.push(condition.split('(')[0]);
                            temp.push('in');

                            let temp_values = condition.split('(')[1].split('|');
                            console.log(temp_values)

                            temp_values.forEach((x, i) => {
                                temp_values[i] = x.replace('(', '').replace(')', '');
                            });
                            temp.push(temp_values);
                            conditions.push(temp);
                        }
                        else if (condition.indexOf(">=") !== -1){
                            temp.push(condition.split(">=")[0]);
                            temp.push('morethanequals');
                            temp.push(condition.split(">=")[1]);
                            conditions.push(temp);
                        }
                        else if (condition.indexOf("<=") !== -1){
                            temp.push(condition.split("<=")[0]);
                            temp.push('lessthanequals');
                            temp.push(condition.split("<=")[1]);
                            conditions.push(temp);
                        }
                        else if (condition.indexOf("!=") !== -1){
                            temp.push(condition.split("!=")[0]);
                            temp.push('notequals');
                            temp.push(condition.split("!=")[1]);
                            conditions.push(temp);
                        }
                        else if (condition.indexOf("=") !== -1){
                            temp.push(condition.split("=")[0]);
                            temp.push('equals');
                            temp.push(condition.split("=")[1]);
                            conditions.push(temp);
                        }
                        else if (condition.indexOf("<") !== -1){
                            temp.push(condition.split("<")[0]);
                            temp.push('lessthan');
                            temp.push(condition.split("<")[1]);
                            conditions.push(temp);
                        }
                        else if (condition.indexOf(">") !== -1){
                            temp.push(condition.split(">")[0]);
                            temp.push('morethan');
                            temp.push(condition.split(">")[1]);
                            conditions.push(temp);
                        }
                    }
                    console.log(conditions);
                }

                try{
                    api_res = await axios.post(api_url + '/selectrow', {
                        username: username, password: password,
                        filename: filename, databasename: databasename,
                        selected_columns: selected_columns, predefinedoptions: 'none',
                        conditions: conditions
                    });
                    return api_res.data;
                }
                catch(e){
                    console.log('error retrieving row ', e);
                    return api_res.data.message;
                }
            }
            else if (q[0] === 'put'){
                let rows = [];

                //syntax error check
                {
                    if (!(q[1].includes('[') && q[1].includes(']'))){
                        message = `Column Specification Lack []`;
                        throw new Error();
                    }
                }
                try{
                    let columns = await axios.post(api_url + '/columndetails', {username : username, password: password, filename: filename, databasename: databasename});
                    columns = columns.data.columns;

                    let values = q[1].split(",");
                    values.forEach((x, i) => {
                        values[i] = x.replace("[", "").replace("]", "");
                    });

                    let temp = {};
                    for (let column of columns){
                        for (let value of values){
                            if (value.split("=")[0] === column.name){
                                temp[column.name] = value.split("=")[1];
                                // rows[`row_1_col_${column.name}`] = value.split("=")[1];
                            }
                        }
                    }
                    rows.push(temp);

                    try{
                        api_res = await axios.post(api_url + '/insertrow', {
                            username: username, password: password,
                            filename: filename, databasename: databasename,
                            rows: rows
                        });
                        return api_res.data;
                    }
                    catch(e){
                        console.log('error inserting row ', e);
                        return api_res.data.message;
                    }
                }
                catch(e){
                    console.error('error retrieving file columnar details')
                }
            }
            else if (q[0] === 'change'){
                let columns_to_be_sent = [];
                let conditions = null;

                //syntax error check
                {
                    if (!(q[1].includes('[') && q[1].includes(']'))){
                        message = `Column Specification Lack []`;
                        throw new Error();
                    }

                    if (q[2]!=='if'){
                        message =  `Unrecognized Symbol "${q[2]}". "if" Keyword Missing`;
                        throw new Error();
                    }

                    if (!(q[3].includes('[') && q[3].includes(']'))){
                        message = `Condition Specification Lack []`;
                        throw new Error();
                    }
                }
                try{
                    let columns = await axios.post(api_url + '/columndetails', {username : username, password: password, filename: filename, databasename: databasename});
                    columns = columns.data.columns;

                    let values = q[1].split(",");
                    values.forEach((x, i) => {
                        values[i] = x.replace("[", "").replace("]", "");
                    });
                    console.log(values);
                    for (let column of columns){
                        for (let value of values){
                            if (value.split("=")[0] === column.name){
                                let rawValue = value.split("=")[1];
                                let parsedValue;
                                if (column.type === 'int') {
                                    parsedValue = Number(rawValue);
                                }
                                else if (column.type === 'float') {
                                    parsedValue = Number(rawValue);
                                }
                                else {
                                    parsedValue = rawValue; // string
                                }

                                columns_to_be_sent.push([column.name, parsedValue]);

                            }
                        }
                    }
                    console.log(columns_to_be_sent);
                    if (q[2] === 'if' && q[3]){
                        conditions = [];
                        let cns = q[3].split(",");
                        cns.forEach((x, i) => {
                            cns[i] = x.replace("[", "").replace("]", "");
                        });
                        for (let condition of cns){
                            let temp = [];

                            if (condition.includes('(') === true && condition.includes(')') === true){
                                temp.push(condition.split('(')[0]);
                                temp.push('in');

                                let temp_values = condition.split('(')[1].split('|');
                                console.log(temp_values)

                                temp_values.forEach((x, i) => {
                                    temp_values[i] = x.replace('(', '').replace(')', '');
                                });
                                temp.push(temp_values);
                                conditions.push(temp);
                            }
                            else if (condition.indexOf(">=") !== -1){
                                temp.push(condition.split(">=")[0]);
                                temp.push('morethanequals');
                                temp.push(condition.split(">=")[1]);
                                conditions.push(temp);
                            }
                            else if (condition.indexOf("<=") !== -1){
                                temp.push(condition.split("<=")[0]);
                                temp.push('lessthanequals');
                                temp.push(condition.split("<=")[1]);
                                conditions.push(temp);
                            }
                            else if (condition.indexOf("!=") !== -1){
                                temp.push(condition.split("!=")[0]);
                                temp.push('notequals');
                                temp.push(condition.split("!=")[1]);
                                conditions.push(temp);
                            }
                            else if (condition.indexOf("=") !== -1){
                                temp.push(condition.split("=")[0]);
                                temp.push('equals');
                                temp.push(condition.split("=")[1]);
                                conditions.push(temp);
                            }
                            else if (condition.indexOf("<") !== -1){
                                temp.push(condition.split("<")[0]);
                                temp.push('lessthan');
                                temp.push(condition.split("<")[1]);
                                conditions.push(temp);
                            }
                            else if (condition.indexOf(">") !== -1){
                                temp.push(condition.split(">")[0]);
                                temp.push('morethan');
                                temp.push(condition.split(">")[1]);
                                conditions.push(temp);
                            }
                        }
                    }
                    console.log(conditions);

                    try{
                        api_res = await axios.post(api_url + '/updaterow', {
                            username: username, password: password,
                            filename: filename, databasename: databasename,
                            conditions: conditions, columns: columns_to_be_sent
                        });
                        return api_res.data;
                    }
                    catch(e){
                        console.log('error updating row ', e);
                        return api_res.data.message;
                    }
                }
                catch(e){
                    console.error('error retrieving file columnar details')
                }
            }
            else if (q[0] === 'remove'){
                let selected_columns = []
                let conditions = null;

                //syntax error check
                {
                    if (!(q[1].includes('[') && q[1].includes(']'))){
                        message = `Column Specification Lack []`;
                        throw new Error();
                    }

                    if (q[2]!=='if'){
                        message =  `Unrecognized Symbol "${q[2]}". "if" Keyword Missing`;
                        throw new Error();
                    }

                    if (!(q[3].includes('[') && q[3].includes(']'))){
                        message = `Condition Specification Lack []`;
                        throw new Error();
                    }
                }
                //remember we will never go for predefined options..always custom options
                if (q[1].includes("all")){
                    selected_columns.push('*');
                }
                else{
                    // for converting the string of column names into an array
                    selected_columns = q[1].split(",");
                    selected_columns.forEach((x, i) => {
                        selected_columns[i] = x.replace("[", "").replace("]", "");
                    });
                }

                if (q[2] === 'if' && q[3]){
                    conditions = [];
                    let cns = q[3].split(",");
                    cns.forEach((x, i) => {
                        cns[i] = x.replace("[", "").replace("]", "");
                    });
                    for (let condition of cns){
                        let temp = [];

                        if (condition.includes('(') === true && condition.includes(')') === true){
                            temp.push(condition.split('(')[0]);
                            temp.push('in');

                            let temp_values = condition.split('(')[1].split('|');
                            console.log(temp_values)

                            temp_values.forEach((x, i) => {
                                temp_values[i] = x.replace('(', '').replace(')', '');
                            });
                            temp.push(temp_values);
                            conditions.push(temp);
                        }
                        else if (condition.indexOf(">=") !== -1){
                            temp.push(condition.split(">=")[0]);
                            temp.push('morethanequals');
                            temp.push(condition.split(">=")[1]);
                            conditions.push(temp);
                        }
                        else if (condition.indexOf("<=") !== -1){
                            temp.push(condition.split("<=")[0]);
                            temp.push('lessthanequals');
                            temp.push(condition.split("<=")[1]);
                            conditions.push(temp);
                        }
                        else if (condition.indexOf("!=") !== -1){
                            temp.push(condition.split("!=")[0]);
                            temp.push('notequals');
                            temp.push(condition.split("!=")[1]);
                            conditions.push(temp);
                        }
                        else if (condition.indexOf("=") !== -1){
                            temp.push(condition.split("=")[0]);
                            temp.push('equals');
                            temp.push(condition.split("=")[1]);
                            conditions.push(temp);
                        }
                        else if (condition.indexOf("<") !== -1){
                            temp.push(condition.split("<")[0]);
                            temp.push('lessthan');
                            temp.push(condition.split("<")[1]);
                            conditions.push(temp);
                        }
                        else if (condition.indexOf(">") !== -1){
                            temp.push(condition.split(">")[0]);
                            temp.push('morethan');
                            temp.push(condition.split(">")[1]);
                            conditions.push(temp);
                        }
                    }
                }

                try{
                    api_res = await axios.post(api_url + '/deleterow', {
                        username: username, password: password,
                        filename: filename, databasename: databasename,
                        selected_columns: selected_columns, predefinedoptions: 'none',
                        conditions: conditions
                    });
                    return api_res.data;
                }
                catch(e){
                    console.log('error deleting row ', e);
                    return api_res.data.message;
                }
            }
            else if (q[0] === 'create'){
                //syntax error check
                {
                    if (!isAllLower(q[1])){
                        message = `"${q[1]}" Should Be In LowerCase`;
                        throw new Error();
                    }
                    if (!(q[1]==='database' || q[1]==='file')){
                        message = `"${q[1]}" Is Not A Valid Create Type`;
                        throw new Error();
                    }
                }

                if (q[1] === 'database'){
                    let api_res;
                    try{
                        api_res = await axios.post(api_url + '/newdatabase', {username : username, password: password, database_name : q[2]});
                        return api_res.data;
                    }
                    catch(e){
                        console.error('error creating new database ', e);
                        return api_res.data;
                    }
                }
                else if (q[1] === 'file'){
                    let api_res;

                    //syntax error check
                    {
                        if (!isAllLower(q[2])){
                            message = `"${q[2]}" Should Be In LowerCase`;
                            throw new Error();
                        }
                        if (!(q[2]==='table' || q[2]==='json')){
                            message = `"${q[1]}" Is Not A Valid File Type`;
                            throw new Error();
                        }
                    }

                    let file_details = {
                                filename: q[3],
                                databaseselect: databasename,
                                filetypeselect: q[2]
                            }, constraints = [], derivativeinfo = [];

                    if (q[2] === 'table'){

                        //syntax error check
                        {
                            if (!(q[4].includes('[') && q[4].includes(']'))){
                                message = `Column Specification Lack []`;
                                throw new Error();
                            }
                        }

                        let columns = q[4].split(",");
                        columns.forEach((x, i) => {
                            columns[i] = x.replace("[", "").replace("]", "");
                        });
                        
                        let i = 1;
                        for (let column of columns){

                            let temp_derivative = '';
                            if (column.includes('{') && column.includes('}')){
                                temp_derivative = column.slice(column.indexOf('{')+1, );
                                column = column.slice(0, column.indexOf('{'));
                                temp_derivative = temp_derivative.replace('}', '');
                            }
                            derivativeinfo.push(temp_derivative);

                            file_details[`columnname${i}`] = column.split("=")[0];
                            let temp = [];
                            if (column.includes('(') && column.includes(')')){
                                file_details[`columntype${i++}`] = column.split("=")[1].slice(0, column.split('=')[1].indexOf('('));
                                
                                for (let consts of column.split("|")){
                                    if (consts.includes('(')){
                                        consts = consts.slice(consts.indexOf('(')+1)
                                    }
                                    if (consts.includes(')')){
                                        consts = consts.replace(')','')
                                    }
                                    temp.push(consts)
                                }
                            }
                            else{
                                file_details[`columntype${i++}`] = column.split('=')[1];
                            }
                            
                            constraints.push(temp);
                        }
                        file_details['derivativeinfo'] = derivativeinfo;
                    }
                    else if (q[2] === 'json'){
                        console.log(file_details)

                    }
                    try{
                        api_res = await axios.post(api_url + '/newfile', {username : username, password: password,
                            file_details: file_details, constraints: constraints
                        });
                        return api_res.data;
                    }
                    catch(e){
                        console.error('error creating new file ', e);
                        return api_res.data;
                    }
                }
            }
            else if (q[0] === 'join'){
                //syntax error logic
                {
                    if (!isAllLower(q[4])){
                        message = `"${q[4]}" Should Be In LowerCase`;
                        throw new Error();
                    }
                    else if (!(q[4]==='inner' || q[4]==='outer' || q[4]==='left' || q[4]==='right' || q[4]==='cross')){
                        message = `"${q[4]}" Is Not A Valid Join Type`;
                        throw new Error();
                    }
                }

                let table2 = `${q[6]}.txt.json`, join_type = q[4], primary_columns = [], secondary_columns = [], column_details, export_table = 'null';
                
                //syntax error logic
                if (!(q[1].includes('[') && q[1].includes(']') && q[7].includes('[') && q[7].includes(']'))){
                    message = `Column Specification Lack []`;
                    throw new Error();
                }

                if (q[1].includes('all')){
                    column_details = await axios.post(api_url + '/columndetails', {
                        username: username, password: password,
                        filename: filename, databasename: databasename
                    });
                    for (let column of column_details.data.columns){
                        primary_columns.push(column.name);
                    }
                }
                else{
                    primary_columns = q[1].split(',');
                    primary_columns.forEach((x, i) => {
                        primary_columns[i] = x.replace('[','').replace(']','');
                    });
                }

                if (q[7].includes('all')){
                    column_details = await axios.post(api_url + '/columndetails', {
                        username: username, password: password,
                        filename: table2, databasename: databasename
                    });
                    for (let column of column_details.data.columns){
                        secondary_columns.push(column.name);
                    }
                }
                else{
                    secondary_columns = q[7].split(',');
                    secondary_columns.forEach((x, i) => {
                        secondary_columns[i] = x.replace('[','').replace(']','');
                    });
                }

                //syntax error logic
                {
                    if (q[2]!=='by'){
                        message =  `Unrecognized Symbol "${q[2]}". "by" Keyword Missing`;
                        throw new Error();
                    }
                    else if (q[8]!=='by'){
                        message =  `Unrecognized Symbol "${q[8]}". "by" Keyword Missing`;
                        throw new Error();
                    }
                    else if (q[10]!=='and'){
                        message =  `Unrecognized Symbol "${q[10]}". "and" Keyword Missing`;
                        throw new Error();
                    }
                    else if (q[5]!=='with'){
                        message =  `Unrecognized Symbol "${q[5]}". "with" Keyword Missing`;
                        throw new Error();
                    }
                    if (q[11] && q[11]!=='export'){
                        message =  `Unrecognized Symbol "${q[11]}". "export" Keyword Missing`;
                        throw new Error();
                    }
                    if (q[11] && !q[12]){
                        message = `Destination Table Name Missing`;
                        throw new Error();
                    }
                }

                if (q[11] === 'export' && q[12]){
                    export_table = `${q[12]}.txt.json`;
                }

                try{
                    api_res = await axios.post(api_url + `/join?type=${join_type}join`, {
                        username: username, password: password,
                        filename: filename, databasename: databasename,
                        key1: q[3], primary_columns: primary_columns,
                        table2: table2, key2: q[9], secondary_columns: secondary_columns,
                        export_table: export_table
                    });
                    return api_res.data;
                }
                catch(e){
                    console.log('error joining tables ', e);
                    return api_res.data.message;
                }
            }
            else if (q[0] === 'sort'){
                let selected_columns = [], export_table = 'null';

                //syntax error check
                {
                    if (!(q[1].includes('[') && q[1].includes(']'))){
                        message = `Column Specification Lack []`;
                        throw new Error();
                    }
                }


                if (q[1].includes('all')){
                    selected_columns.push('*');
                }
                else{
                    selected_columns = q[1].split(',')
                    selected_columns.forEach((x, i) => {
                        selected_columns[i] = x.replace('[', '').replace(']', '');
                    });
                }

                //syntax error logic
                {
                    if (q[2]!=='on'){
                        message =  `Unrecognized Symbol "${q[2]}. "on" Keyword Missing"`;
                        throw new Error();
                    }
                    if (!isAllLower(q[4])){
                        message = `"${q[4]}" Should Be In LowerCase`;
                        throw new Error();
                    }
                    if (!(q[4]==='asc' || q[4]==='desc')){
                        message = `"${q[4]}" Is Not A Valid Sorting Order Type`;
                        throw new Error();
                    }
                }

                //syntax error check
                {
                    if ( q[5] && !isAllLower(q[5])){
                        message = `"${q[5]}" Should Be In LowerCase`;
                        throw new Error();
                    }
                    if (q[5] && q[5]!=='and'){
                        message = `Unrecognized Symbol "${q[5]}". "and" Keyword Missing`;
                        throw new Error();
                    }
                    if (q[6] && !isAllLower(q[6])){
                        message = `"${q[6]}" Should Be In LowerCase`;
                        throw new Error();
                    }
                    if (q[6] && q[6]!=='export'){
                        message = `Unrecognized Symbol "${q[6]}". "export" Keyword Missing`;
                        throw new Error();
                    }
                }

                if (q[6] === 'export' && q[7]){
                    export_table = `${q[7]}.txt.json`;
                }

                try{
                    api_res = await axios.post(api_url + `/sort`, {
                        username: username, password: password,
                        filename: filename, databasename: databasename, sortingkey: q[3],
                        sortingorder: q[4], selected_columns: selected_columns,
                        export_table: export_table
                    });
                    return api_res.data;
                }
                catch(e){
                    console.log('error joining tables ', e);
                    return api_res.data.message;
                }
            }
            else if (q[0] === 'split'){
                let new_columns = null, new_table_name = null, conditions = null, split_type = null;
                
                //syntax error check
                if (!isAllLower(q[1])){
                    message = `"${q[1]}" Should Be In LowerCase`;
                    throw new Error();
                }
                else if (!(q[1]==='vertical' || q[1]==='horizontal')){
                    message = `"${q[1]}" Is Not A Valid Split Type`;
                    throw new Error();
                }

                if (q[1] === 'vertical'){
                    split_type = q[1];

                    //syntax error check
                    if (!(q[2].includes('[') && q[2].includes(']'))){
                        message = `Column Specification Lack []`;
                        throw new Error();
                    }

                    new_columns = q[2].split(',')
                    new_columns.forEach((x, i) => {
                        new_columns[i] = x.replace('[', '').replace(']', '');
                    });

                    //syntax error check
                    if (q[3] !== 'to'){
                        message =  `Unrecognized Symbol "${q[3]}". "to" Keyword Missing`;
                        throw new Error;
                    }
                    else if (!q[4]){
                        message = `Destination Table Name Missing`;
                        throw new Error();
                    }
                    else{
                        new_table_name = q[4];
                    }
                }
                else if (q[1] === 'horizontal'){
                    split_type = q[1];

                    //syntax error check
                    if (q[2] !== 'to'){
                        message =  `Unrecognized Symbol "${q[2]}". "to" Keyword Missing`;
                        throw new Error;
                    }
                    else if (q[3] === 'if'){
                        message = `Destination Table Name Missing`;
                        throw new Error();
                    }
                    else{
                        new_table_name = q[3];
                    }
                    if (q[4] !== 'if'){
                        message = `Conditional Keyword "if" Missing`;
                        throw new Error();
                    }
                    if (!(q[5].includes('[') && q[5].includes(']'))){
                        message = `Condition Specification Lack []`;
                        throw new Error();
                    }

                    let temp_conditions = q[5].split(',');
                    conditions = [];

                    temp_conditions.forEach((x, i) => {
                        temp_conditions[i] = x.replace('[', '').replace(']', '');
                    });

                    for (let condition of temp_conditions){
                        let temp = [];
                        console.log(condition)
                        if (condition.includes('(') === true && condition.includes(')') === true){
                            temp.push(condition.split('(')[0]);
                            temp.push('in');

                            let temp_values = condition.split('(')[1].split('|');
                            console.log(temp_values)

                            temp_values.forEach((x, i) => {
                                temp_values[i] = x.replace('(', '').replace(')', '');
                            });
                            temp.push(temp_values);
                            conditions.push(temp);
                        }
                        else if (condition.includes('<=') === true){
                            temp.push(condition.split("<=")[0]);
                            temp.push('lessthanequals');
                            temp.push(condition.split("<=")[1]);
                            conditions.push(temp);
                        }
                        else if (condition.includes('>=') === true){
                            temp.push(condition.split(">=")[0]);
                            temp.push('morethanequals');
                            temp.push(condition.split(">=")[1]);
                            conditions.push(temp);
                        }
                        else if (condition.includes('=') === true){
                            temp.push(condition.split("=")[0]);
                            temp.push('equals');
                            temp.push(condition.split("=")[1]);
                            conditions.push(temp);
                        }
                        else if (condition.includes('!=') === true){
                            temp.push(condition.split("!=")[0]);
                            temp.push('notequals');
                            temp.push(condition.split("!=")[1]);
                            conditions.push(temp);
                        }
                        else if (condition.includes('<') === true){
                            temp.push(condition.split("<")[0]);
                            temp.push('lessthan');
                            temp.push(condition.split("<")[1]);
                            conditions.push(temp);
                        }
                        else if (condition.includes('>') === true){
                            temp.push(condition.split(">")[0]);
                            temp.push('morethan');
                            temp.push(condition.split(">")[1]);
                            conditions.push(temp);
                        }
                        else{
                            message = `Condition "${condition}" Is Invalid`;
                            throw new Error();
                        }
                        
                    }
                }

                try{
                    api_res = await axios.post(api_url + `/split?type=${split_type}split`, {
                        username: username, password: password,
                        filename: filename, databasename: databasename,
                        new_table_name: new_table_name, new_columns: new_columns,
                        conditions: conditions
                    });
                    return api_res.data;
                }
                catch(e){
                    console.log('error splitting table ', e);
                    return api_res.data.message;
                }
            }
            else if (q[0] === 'find'){
                //syntax error checking
                {
                    if (!isAllLower(q[1])){
                        message = `"${q[1]}" Should Be In LowerCase`;
                        throw new Error();
                    }
                    else if (!(q[1]==='key' || q[1]==='value')){
                        message = `"${q[1]}" Is Not A Valid Find Type`;
                        throw new Error();
                    }
                }

                if (q[1] === 'key'){
                    try{
                        //syntax error checking
                        {
                            if (isAllLower(q[3]) === false){
                                message = `"${q[3]}" Should Be In LowerCase`;
                                throw new Error();
                            }
                            else if (!(q[3] ==='exact' || q[3] ==='partial' || q[3] ==='caseinsensitive')){
                                message = `"${q[3]}" Is Not A Valid Match Type`;
                                throw new Error();
                            }
                        }

                        api_res = await axios.post(api_url + `/find`, {
                            username: username, password: password,
                            filename: filename, databasename: databasename,
                            findType: q[1], keyName: q[2],
                            matchType: q[3]
                        });
                        return api_res.data;
                    }
                    catch(e){
                        console.log('error finding key ', e);
                        return api_res.data.message;
                    }
                }
                else if (q[1] === 'value'){
                    //syntax error checking
                    {
                        if (isAllLower(q[3]) === false){
                            message = `"${q[3]}" Should Be In LowerCase`;
                            throw new Error();
                        }
                        else if (!(q[3]==='string' || q[3]==='number' || q[3]==='boolean')){
                            message = `"${q[3]}" Is Not A Valid Value Type`;
                            throw new Error();
                        }

                        if (isAllLower(q[4]) === false){
                            message = `"${q[4]}" Should Be In LowerCase`;
                            throw new Error();
                        }
                        else if (!(q[4] === 'equals' || q[4] === 'contains' || q[4] === 'notequals' || q[4] === 'lessthan' || q[4] === 'lessthanequals' || q[4] === 'morethanequals' || q[4] === 'morethan')){
                            message = `"${q[4]}" Is Not A Valid Operator`;
                            throw new Error();
                        }
                    }

                    try{
                        api_res = await axios.post(api_url + `/find`, {
                            username: username, password: password,
                            filename: filename, databasename: databasename,
                            findType: q[1],valueName: q[2],
                            valueType:  q[3], operator: q[4]
                        });
                        return api_res.data;
                    }
                    catch(e){
                        console.log('error finding value ', e);
                        return api_res.data.message;
                    }
                }
            }
            else if (q[0] === 'rename'){
                if (!(q[1] === 'database' || q[1] === 'file')){
                    message =  `Unrecognized Symbol "${q[1]}"`;
                    throw new Error;
                }

                if (q[1] === 'database'){
                    if (q[3] !== 'to'){
                        message =  `Unrecognized Symbol "${q[3]}". "to" Keyword Missing`;
                        throw new Error;
                    }
                    try{
                        api_res = await axios.post(api_url + '/renamedatabase', {username : username, password: password, database : q[2], name: q[4]});
                        return api_res.data;
                    }
                    catch(e){
                        console.error('error renaming database ', e);
                        return api_res.data.message;
                    }
                }
                else if (q[1] === 'file'){
                    if (!isAllLower(q[2])){
                        message = `"${q[2]}" Should Be In LowerCase`;
                        throw new Error();
                    }
                    if (!(q[2] === 'table' || q[2] === 'json')){
                        message = `"${q[2]}" Is Not A Valid File Type`;
                        throw new Error();
                    }
                    if (q[4] !== 'to'){
                        message =  `Unrecognized Symbol "${q[4]}". "to" Keyword Missing`;
                        throw new Error;
                    }

                    let file = q[2] === 'table' ? `${q[3]}.txt.json` : `${q[3]}.json`;

                    try{
                        api_res = await axios.post(api_url + '/renamefile', {username : username, password: password, database : databasename, file: file, name: q[5]});
                        return api_res.data;
                    }
                    catch(e){
                        console.error('error renaming file ', e);
                        return api_res.data.message;
                    }
                }
            }
            else if (q[0] === 'modify'){
                if (q[1] !== 'schema'){
                    message =  `Unrecognized Symbol "${q[1]}"`;
                    throw new Error;
                }
                if (!(q[2] === 'addcolumn' || q[2] === 'removecolumn' || q[2] === 'changecolumnname' || q[2] === 'changecolumntype' || q[2] === 'changecolumnconstraints' || q[2] === 'customchange')){
                    message = `"${q[2]}" Is Not A Valid Modify Schema Type`;
                    throw new Error();
                }
                if (!(q[3].includes('[') && q[3].includes(']'))){
                    message = `Column Specification Lack []`;
                    throw new Error();
                }

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

                let constraints = [], derivatives = [], column_names = [], column_types = [];
                if (q[2] === 'addcolumn'){
                    let columns = q[3].split(",");
                    columns.forEach((x, i) => {
                        columns[i] = x.replace("[", "").replace("]", "");
                    });
                        
                    let i = 1;
                    for (let column of columns){
                        let temp_derivative = '';
                        if (column.includes('{') && column.includes('}')){
                            temp_derivative = column.slice(column.indexOf('{')+1, );
                            column = column.slice(0, column.indexOf('{'));
                            temp_derivative = temp_derivative.replace('}', '');
                        }
                        derivatives.push(temp_derivative);

                        column_names.push(column.split("=")[0]);

                        let temp = [];
                        if (column.includes('(') && column.includes(')')){
                            column_types.push(column.split("=")[1].slice(0, column.split('=')[1].indexOf('(')));
                                
                            for (let consts of column.split("|")){
                                if (consts.includes('(')){
                                    consts = consts.slice(consts.indexOf('(')+1)
                                }
                                if (consts.includes(')')){
                                    consts = consts.replace(')','')
                                }
                                temp.push(consts)
                            }
                        }
                        else{
                            column_types.push(column.split('=')[1]);
                        }
                        
                        constraints.push(temp);
                    }
                }
                else if (q[2] === 'removecolumn'){

                    if (q[3].includes("all")) columnlength.forEach(c => {column_names.push(c.name)});
                    else{
                        // for converting the string of column names into an array
                        column_names = q[3].split(",");
                        column_names.forEach((x, i) => {
                            column_names[i] = x.replace("[", "").replace("]", "");
                        });
                    }
                }
                else if (q[2] === 'changecolumnname'){
                    let names = q[3].split(",");
                    names.forEach((x, i) => {
                        let temp = x.replace("[", "").replace("]", "");
                        names[i] = temp.split('=');
                    });

                    columnlength.forEach(c => {
                        let flag = 0;
                        for (let x of names){
                            if (x[0] === c.name){
                                column_names.push(x[1]);
                                flag = 1;
                                break;
                            }
                        }
                        if (!flag) column_names.push(c.name)
                    });
                }
                else if (q[2] === 'changecolumntype'){
                    let names = q[3].split(",");
                    names.forEach((x, i) => {
                        let temp = x.replace("[", "").replace("]", "");
                        names[i] = temp.split('=');
                    });

                    columnlength.forEach(c => {
                        let flag = 0;
                        for (let x of names){
                            if (x[0] === c.name){
                                column_names.push(x[0]);
                            
                                if (x[1].includes('{') && x[1].includes('}')){
                                    derivatives.push(x[1].slice(x[1].indexOf('{')+1, ).replace('}', ''));
                                    column_types.push(x[1].slice(0, x[1].indexOf('{')));
                                }
                                else{
                                    column_types.push(x[1]);
                                    derivatives.push('');
                                } 
                                flag = 1;
                                break;
                            }
                        }
                        if (!flag){
                            column_names.push(c.name);
                            column_types.push(c.type);
                            derivatives.push(c.expression);
                        } 
                    });
                }
                else if (q[2] === 'changecolumnconstraints'){
                    let names = q[3].split(",");
                    names.forEach((x, i) => {
                        let temp = x.replace("[", "").replace("]", "");
                        names[i] = temp.split('(');
                    });

                    columnlength.forEach(c => {
                        let flag = 0;
                        for (let x of names){
                            if (x[0] === c.name){
                                column_names.push(x[0]);

                                x[1] = x[1].split('|');
                                x[1].forEach((y, i)=>{
                                    x[1][i] = x[1][i].replace(')', '');
                                });

                                constraints.push(x[1]);
                                flag = 1;
                                break;
                            }
                        }
                        if (!flag){
                            column_names.push(c.name);
                            constraints.push(c.constraints);
                        } 
                    });
                }
                else if (q[2] === 'customchange'){
                    let columns = q[3].split(",");
                    columns.forEach((x, i) => {
                        columns[i] = x.replace("[", "").replace("]", "");
                    });
                        
                    let i = 1;
                    for (let column of columns){
                        let temp_derivative = '';
                        if (column.includes('{') && column.includes('}')){
                            temp_derivative = column.slice(column.indexOf('{')+1, );
                            column = column.slice(0, column.indexOf('{'));
                            temp_derivative = temp_derivative.replace('}', '');
                        }
                        derivatives.push(temp_derivative);

                        column_names.push(column.split("=")[0]);

                        let temp = [];
                        if (column.includes('(') && column.includes(')')){
                            column_types.push(column.split("=")[1].slice(0, column.split('=')[1].indexOf('(')));
                                
                            for (let consts of column.split("|")){
                                if (consts.includes('(')){
                                    consts = consts.slice(consts.indexOf('(')+1)
                                }
                                if (consts.includes(')')){
                                    consts = consts.replace(')','')
                                }
                                temp.push(consts)
                            }
                        }
                        else{
                            column_types.push(column.split('=')[1]);
                        }
                        
                        constraints.push(temp);
                    }

                    //change part
                    {
                        let file_data = await fs.readFile(path.join(__dirname, "users", `${username}_${password}`, `${databasename}`, `${filename}`), 'utf-8');
                        file_data = JSON.parse(file_data);

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

                            await fs.writeFile(
                                path.join(__dirname, "users", `${username}_${password}`, databasename, filename),
                                JSON.stringify(temp_file_data, null, 2)
                            );
                            

                            api_res = await axios.post(api_url + '/insertrow', {
                                username: username, password: password,
                                filename: filename, databasename: databasename,
                                rows: file_data.rows
                            });
                            console.log(api_res.data.message)

                            if (api_res.data.message !== 'Insertion Successful'){
                                api_res.data.message = `Table Schema Change Unsuccessful. ${api_res.data.message}`;
                                await fs.writeFile(
                                path.join(__dirname, "users", `${username}_${password}`, databasename, filename),
                                JSON.stringify(file_data, null, 2)
                            );
                            }
                            else{
                                api_res.data.message = "Table Schema Change Successful";
                            }
                            return api_res.data;
                    }
                }

                try{
                    api_res = await axios.post(api_url + `/changeschema`, {
                        username : username, password: password,
                        databasename: databasename, filename: filename, changeschemaType: q[2],
                        column_names: column_names, column_types: column_types,
                        derivatives: derivatives, constraints: constraints
                    });
                    return api_res.data;
                }
                catch(e){
                    console.log('error changing table schema ', e);
                    return api_res.data.message;
                }
            }
            else{
                message = `"${q[0]}" Is Not Recognized`;
                throw new Error();
            }
        }
    }
    catch(e){
        console.log('query format error ', e);
        return {message: message};
    }
}

app.get('/get_databases',async function(req, res){
    const req_params = req.query;
    try{
        const databases = await show_in_folder(`/users/${req_params.username}_${req_params.password}`);
        
        const all_files = [];
        for (let database of databases){
            if (database.endsWith('.DS_Store')) continue
            let files = await show_in_folder(`/users/${req_params.username}_${req_params.password}/${database}`);
            files = files.filter(x => x !== 'query_history.json');
            all_files.push(
                {
                    database_name: database,
                    database_files: files
                }
            );
        }
        console.log(all_files);
        return res.json(
            {
                databases: all_files
            }
        );
    }
    catch(e){
        console.error('error retrieving database names ', e);
        return res.json(
            {
                message: "error retrieving databases !"
            }
        );
    }
});

app.post('/get_authentication_data', async function(req, res){
    let file_data = await fs.readFile(filepath, 'utf-8');
    file_data = JSON.parse(file_data);
    for (let line of file_data){
        if (line.username === req.body.username){
            const match = await bcrypt.compare(req.body.password, line.password);
            console.log(line.firstname, line.lastname, req.body.password, line.password)
            if (match){
                let lastDate = new Date(line.previous_login);   // Date object
                let now = Date.now();                           // number (ms)
                let diff = now - lastDate.getTime();            // difference in ms

                if (diff < 60_000) lastDate="just now"
                else if (diff < 3_600_000) lastDate=`${Math.floor(diff/60000)} minute(s) ago ( ${lastDate.toLocaleString()} )`
                else if (diff < 86_400_000) lastDate=`${Math.floor(diff/3600000)} hour(s) ago ( ${lastDate.toLocaleString()} )`
                else if (diff < 2_678_400_000) lastDate=`${Math.floor(diff/86400000)} day(s) ago ( ${lastDate.toLocaleString()} )`
                else lastDate= lastDate.toLocaleString()

                return res.json({firstname: line.firstname, lastname: line.lastname,
                phone: line.phone, username: line.username,
                last_logged_in: lastDate, password: line.password, credits: line.credits});
            }
            else return res.send('error');
        }
    }
});

app.post('/editprofile', async function(req, res){
    let file_data = await fs.readFile(filepath, 'utf-8');
    file_data = JSON.parse(file_data);
    console.log(file_data)
    for (let line of file_data){
        console.log(1)
        if (line.username === req.body.oldusername){
            console.log(2, line.password, req.body.password)
            const match = await bcrypt.compare(req.body.password, line.password);
            console.log(line.firstname, line.lastname)
            if (match){
                console.log(3)
                line.firstname = req.body.firstname;
                line.lastname = req.body.lastname;

                if (req.body.oldusername !== req.body.username){
                    await fs.rename(path.join(__dirname, "users", `${req.body.oldusername}_${req.body.password}`), path.join(__dirname, "users", `${req.body.username}_${req.body.password}`))
                }
                line.username = req.body.username;
                console.log(file_data)

                await fs.writeFile(filepath, JSON.stringify(file_data, null, 2));

                return res.json({message: "success"});
            }
            else return res.send('error');
        }
    }
});

app.post('/changepassword', async function(req, res){
    let file_data = await fs.readFile(filepath, 'utf-8');
    file_data = JSON.parse(file_data);

    for (let line of file_data){
        console.log('vansh',line.username, req.body.username)
        if (line.username === req.body.username){
            console.log('bhopal',req.body.password, line.password)
            const match = await bcrypt.compare(req.body.password, line.password);
            if (match){
                console.log(match)
                bcrypt.hash(req.body.newpassword, salt_rounds, async function(err, hash){
                    if (err) console.error('error hashing passwords ', err);

                    line.password = hash;

                    console.log(req.body.newpassword, req.body.password)

                    await fs.rename(path.join(__dirname, "users", `${req.body.username}_${req.body.password}`), path.join(__dirname, "users", `${req.body.username}_${req.body.newpassword}`))

                    await fs.writeFile(filepath, JSON.stringify(file_data, null, 2));

                    return res.json({message: "success"});
                });
            }
            else return res.send('error');
        }
    }
});

app.post('/delete_account', async function(req, res){
    const req_data = req.body;
    console.log(req_data);
    try{
        await fs.rm(path.join(__dirname, "users", `${req_data.username}_${req_data.password}`), {recursive: true, force: true});
        

        let data = null;
        try{
            data = await fs.readFile(filepath, 'utf-8');
            data = JSON.parse(data);
            for (let line=0; line<data.length; line++){
                console.log(data[line]);
                if (data[line].username === req_data.username){
                    const match = await bcrypt.compare(req_data.password, data[line].password);
                    if (match){
                        data.splice(line, 1);
                        await fs.writeFile(filepath, JSON.stringify(data, null, 2));
                        break;
                    } 
                }
            } 
        }
        catch(e){
            console.error('error reading json ', e);
        }

        console.log('account deleted !');
        return res.json(
            {
                message: `Account Deleted !`
            }
        );
    }
    catch(e){
        console.error('error deleting account ', e);
        return res.json(
            {
                message: "Error Deleting Account !"
            }
        );
    }
});

app.post('/serversignup', async function(req, res){
    await enter_new_user(req.body.details);
    res.json({message: "new user added !"});
});

app.post('/serverlogin', async function(req, res){
    const flag = await check_authentication(req.body.details);
    console.log('hey')
    console.log(flag);
        if (flag === 1){
            return res.json({flag: 1});
        }
        else if (flag === 0){
            return res.json({flag: 0});
        }
});

app.post('/newuser',async function(req, res){
    const data = req.body;
    try{
        await fs.mkdir(path.join(__dirname, "users", `${req.body.username}_${req.body.password}`), {recursive: true});
        console.log('new user folder created !');
        return res.json(
            {
                message: "new user folders created !"
            }
        );
    }
    catch(e){
        console.error('error creating new user folder ', e);
        return res.json(
            {
                message: "error creating new users folders !"
            }
        );
    }
});

app.post('/newdatabase', async function(req, res){
    const data = req.body;
    console.log(data);
    try{
        await fs.mkdir(path.join(__dirname, "users", `${data.username}_${data.password}`, `${data.database_name}`), {recursive: true});

        await fs.writeFile(
            path.join(__dirname, "users", `${data.username}_${data.password}`, data.database_name, 'query_history.json'),'{}'
        );
        console.log('new database created !');
        return res.json(
            {
                message: `New Database ${data.database_name} Created !`
            }
        );
    }
    catch(e){
        console.error('error creating new database ', e);
        return res.json(
            {
                message: "Error Creating New Database !"
            }
        );
    }
});

app.post('/deletedatabase', async function(req, res){
    const data = req.body;
    console.log(data);
    try{
        await fs.rm(path.join(__dirname, "users", `${data.username}_${data.password}`, `${data.database}`), {recursive: true, force: true});
        console.log('database deleted !');
        return res.json(
            {
                message: `Database ${data.database} Deleted !`
            }
        );
    }
    catch(e){
        console.error('error deleting database ', e);
        return res.json(
            {
                message: "Error Deleting Database !"
            }
        );
    }
});

app.post('/renamedatabase', async function(req, res){
    const data = req.body;
    console.log(data);
    try{
        await fs.rename(path.join(__dirname, "users", `${data.username}_${data.password}`, `${data.database}`),
         path.join(__dirname, "users", `${data.username}_${data.password}`, `${data.name}`));

        console.log('database renamed !');
        return res.json(
            {
                message: `Database ${data.database} Renamed To ${data.name} !`
            }
        );
    }
    catch(e){
        console.error('error renaming new database ', e);
        return res.json(
            {
                message: "Error Renaming Database !"
            }
        );
    }
});

app.post('/newfile', async function(req, res){
    const data = req.body;
    console.log(data, 'hey');
    const file_data = {
        filetype: `${data.file_details.filetypeselect}`,
        rows:[]
    };
    let fileext = '';
    if (data.file_details.filetypeselect === 'table'){
        fileext = `txt.json`;
        file_data.columns=[];
        for (let i = 1; ;i++){
            if (data.file_details[`columnname${i}`] && data.file_details[`columntype${i}`]){
                file_data.columns.push(
                    {name: data.file_details[`columnname${i}`],
                     type: data.file_details[`columntype${i}`],
                     expression: data.file_details.derivativeinfo[i-1],
                     constraints: data.constraints[i-1]
                    });
            }
            else{
                break;
            }
        }
    }
    else{
        fileext = 'json';
        delete file_data.rows;
    }
    try{

        await fs.writeFile(path.join(__dirname, "users", `${data.username}_${data.password}`, `${data.file_details.databaseselect}`, `${data.file_details.filename}.${fileext}`),
            JSON.stringify(file_data, null, 2));

        
        let query_history = await fs.readFile(
            path.join(__dirname, "users", `${data.username}_${data.password}`, data.file_details.databaseselect, 'query_history.json'),
            'utf-8'
        );
        query_history = JSON.parse(query_history);
        query_history[`${data.file_details.filename}.${fileext}`] = [];
        await fs.writeFile(
            path.join(__dirname, "users", `${data.username}_${data.password}`, data.file_details.databaseselect, 'query_history.json'),
            JSON.stringify(query_history, null, 2));
        
        console.log(`new ${data.file_details.filetypeselect} file created !`);
        return res.json(
            {
                message: `New ${data.file_details.filetypeselect} file created !`
            }
        );
    }
    catch(e){
        console.error(`error creating new ${data.file_details.filetypeselect} file `, e);
        return res.json(
            {
                message: `Error creating new ${data.file_details.filetypeselect} file !`
            }
        );
    }
});

app.post('/deletefile', async function(req, res){
    const data = req.body;
    console.log(data);
    try{
        await fs.rm(path.join(__dirname, "users", `${data.username}_${data.password}`, `${data.database}`, `${data.file}`), {recursive: true, force: true});

        let query_history = await fs.readFile(
            path.join(__dirname, "users", `${data.username}_${data.password}`, data.database, 'query_history.json'),
            'utf-8'
        );
        query_history = JSON.parse(query_history);
        // query_history[`${data.file_details.filename}.${fileext}`] = [];
        delete query_history[`${data.file}`];
        await fs.writeFile(
            path.join(__dirname, "users", `${data.username}_${data.password}`, data.database, 'query_history.json'),
            JSON.stringify(query_history, null, 2));


        console.log('file deleted !');
        return res.json(
            {
                message: `File ${data.file} Deleted !`
            }
        );
    }
    catch(e){
        console.error('error deleting file ', e);
        return res.json(
            {
                message: "Error Deleting File !"
            }
        );
    }
});

app.post('/renamefile', async function(req, res){
    const data = req.body;
    console.log(data);
    let new_name = `${data.name}${data.file.endsWith('.txt.json')?'.txt.json':'.json'}`;
    try{
        await fs.rename(path.join(__dirname, "users", `${data.username}_${data.password}`, `${data.database}`, `${data.file}`),
            path.join(__dirname, "users", `${data.username}_${data.password}`, `${data.database}`, new_name));

        let query_history = await fs.readFile(
            path.join(__dirname, "users", `${data.username}_${data.password}`, data.database, 'query_history.json'),
            'utf-8'
        );
        query_history = JSON.parse(query_history);

        query_history[`${new_name}`] = query_history[`${data.file}`];
        delete query_history[`${data.file}`];
        await fs.writeFile(
            path.join(__dirname, "users", `${data.username}_${data.password}`, data.database, 'query_history.json'),
            JSON.stringify(query_history, null, 2));


        console.log('file renamed !');
        return res.json(
            {
                message: `File ${data.file} Renamed To ${new_name}!`
            }
        );
    }
    catch(e){
        console.error('error renaming file ', e);
        return res.json(
            {
                message: "Error Renaming File !"
            }
        );
    }
});

app.post('/columndetails', async function(req, res){
    const data = req.body;
    console.log(data)
    try{
        let file_data = await fs.readFile(path.join(__dirname, "users", `${data.username}_${data.password}`, `${data.databasename}`, `${data.filename}`), 'utf-8');
        file_data = JSON.parse(file_data);
        console.log(file_data)
        return res.json(file_data);
    }
    catch(e){
        console.error('error reading table file for column details ', e);
        return res.json({
            message: 'error fetching column details of table file'
        });
    }
});

app.post('/databasedetails', async function(req, res){
    const data = req.body;
    const files = await fs.readdir(path.join(__dirname, "users", `${data.username}_${data.password}`, `${data.databasename}`), 'utf-8');
    let send_files_data = {};
    for(const file of files){
        if (file.startsWith('query_history') || !file.endsWith('.txt.json')) continue;
        let file_data = await fs.readFile(path.join(__dirname, "users", `${data.username}_${data.password}`, `${data.databasename}`, `${file}`), 'utf-8');
        file_data = JSON.parse(file_data);
        delete file_data.rows;
        send_files_data[file]=file_data
    }
    console.log(send_files_data)
    return res.json(send_files_data)
});

app.post('/insertrow', async function (req, res) {
    const data = req.body;
    let message = 'Insertion Successful';

    try {
        let file_data = await fs.readFile(
            path.join(__dirname, "users", `${data.username}_${data.password}`, data.databasename, data.filename),
            'utf-8'
        );

        file_data = JSON.parse(file_data);
        const columns = file_data.columns;
        const existingRows = file_data.rows;
        const newRows = [];

        // 🔹 Step 1: compute last SERIAL values
        const serialCounters = {};

        for (const col of columns) {
            if (col.constraints.includes('serial')) {
                let max = 0;
                for (const r of existingRows) {
                    if (typeof r[col.name] === 'number') {
                        max = Math.max(max, r[col.name]);
                    }
                }
                serialCounters[col.name] = max;
            }
        }

        // 🔹 Step 2: process each incoming row
        for (const inputRow of data.rows) {
            const row = {};
            let invalid = false;

            for (const col of columns) {
                let value = inputRow[col.name] ? inputRow[col.name] : '';

                // 🔹 SERIAL (auto-generate)
                if (col.constraints.includes('serial')) {
                    serialCounters[col.name]++;
                    value = serialCounters[col.name];
                }

                // 🔹 TYPE CASTING
                if (value !== '') {
                    if (col.type === 'int') value = Number(value);
                    if (col.type === 'float') value = Number(value);
                    if (col.type === 'string') value = String(value);
                }
                else{
                    if (col.type === 'string') value = "";
                    else value = null;
                }

                // 🔹 NOT NULL
                if ((col.constraints.includes('not_null') || col.constraints.includes('primary_key')) && (value === '' || value === null || Number.isNaN(value))) {
                    message = `NOT NULL constraint failed on column "${col.name}"`;
                    invalid = true;
                    // break;
                    throw new Error();
                }

                // 🔹 PRIMARY KEY / UNIQUE
                if (col.constraints.includes('primary_key') || col.constraints.includes('unique')) {
                    const duplicate =
                        existingRows.some(r => r[col.name] === value) ||
                        newRows.some(r => r[col.name] === value);

                    if (duplicate) {
                        message = `Duplicate value "${value}" for column "${col.name}"`;
                        invalid = true;
                        // break;
                        throw new Error();
                    }
                }

                row[col.name] = value;
            }

            for (let column of columns){

                let flag = 1;
                if (column.type === 'derivative'){
                    let potential_columns = column.expression !== '' ? extractColumnDependencies(column.expression) : [];
                    flag = 1;
                    for(let pc of potential_columns){

                        if (row[pc] === undefined || row[pc] === null || row[pc] === ''){
                            flag = 0;
                            break;
                        }
                    }
                    if (flag === 0){
                        row[column.name] = null;
                    } 
                    else{
                        row[column.name] = column.expression !== '' ? evaluateDerivedColumn(column.expression, row) : null;
                    } 
                }
            }

            if (invalid) break;
            if (!invalid) newRows.push(row);
        }

        // 🔹 Step 3: commit once
        file_data.rows.push(...newRows);

        await fs.writeFile(
            path.join(__dirname, "users", `${data.username}_${data.password}`, data.databasename, data.filename),
            JSON.stringify(file_data, null, 2)
        );

        return res.json({ message });

    } catch (err) {
        console.error(err);
        return res.json({ message });
    }
});

app.post('/insertkeyvalue', async function(req, res){
    const data = req.body;
    console.log(data);
    try{
        let file_data = await fs.readFile(path.join(__dirname , "users", `${data.username}_${data.password}`, `${data.databasename}`, `${data.filename}`), 'utf-8');
        file_data = JSON.parse(file_data);
        let clash_behaviour = data.keyvalues.clashbehaviour;

        delete data.keyvalues.clashbehaviour;

        let keys = Object.keys(data.keyvalues);
        console.log(file_data);
        console.log(keys);

        let i = 1;

        while (data.keyvalues[`key_${i}`]){
            let keyPath = data.keyvalues[`key_${i}`];
            let value = data.keyvalues[`value_${i}`];
            console.log(keyPath, value);

            let parsedValue;
            try {
                parsedValue = JSON.parse(value);
            } catch {
                parsedValue = value;
            }
            
            // Parse the key path to handle nesting
            let pathParts = parseKeyPath(keyPath);
            
            if (pathParts.length === 1) {
                // Simple key - no nesting (original behavior)
                let key = pathParts[0];
                
                if (key in file_data){
                    if (clash_behaviour === 'replace'){
                        file_data[key] = parsedValue;
                    }
                    else if (clash_behaviour === 'append'){
                        let current_val = file_data[key];
                        if (Array.isArray(current_val)){
                            file_data[key].push(parsedValue);
                        }
                        else if (typeof current_val === 'object' && current_val !== null){
                            file_data[key][key] = parsedValue;
                        }
                        else{
                            file_data[key] = [current_val, parsedValue];
                        }
                    }
                    else if (clash_behaviour === 'merge'){
                        let current_val = file_data[key];

                        if (Array.isArray(current_val)){
                            if (Array.isArray(parsedValue)) {
                                file_data[key].push(...parsedValue);
                            } else {
                                file_data[key].push(parsedValue);
                            }
                        }
                        else{
                            file_data[key] = [current_val, parsedValue];
                        }
                    }
                    else if (clash_behaviour === 'ignore'){
                        i++;
                        continue;
                    }
                }
                else{
                    file_data[key] = parsedValue;
                }
            } else {
                // Nested key - navigate to target location
                let target = file_data;
                let finalKey = pathParts[pathParts.length - 1];
                
                // Navigate to the parent object/array
                for (let j = 0; j < pathParts.length - 1; j++) {
                    let part = pathParts[j];
                    
                    if (!(part in target)) {
                        // Path doesn't exist - could create it or error
                        console.error(`Path ${keyPath} doesn't exist at ${part}`);
                        i++;
                        continue;
                    }
                    
                    target = target[part];
                }
                
                // Now insert at the target location with clash behavior
                if (finalKey in target){
                    if (clash_behaviour === 'replace'){
                        target[finalKey] = parsedValue;
                    }
                    else if (clash_behaviour === 'append'){
                        let current_val = target[finalKey];
                        if (Array.isArray(current_val)){
                            target[finalKey].push(parsedValue);
                        }
                        else if (typeof current_val === 'object' && current_val !== null){
                            target[finalKey][finalKey] = parsedValue;
                        }
                        else{
                            target[finalKey] = [current_val, parsedValue];
                        }
                    }
                    else if (clash_behaviour === 'merge'){
                        let current_val = target[finalKey];

                        if (Array.isArray(current_val)){
                            if (Array.isArray(parsedValue)) {
                                target[finalKey].push(...parsedValue);
                            } else {
                                target[finalKey].push(parsedValue);
                            }
                        }
                        else{
                            target[finalKey] = [current_val, parsedValue];
                        }
                    }
                    else if (clash_behaviour === 'ignore'){
                        i++;
                        continue;
                    }
                }
                else{
                    target[finalKey] = parsedValue;
                }
            }

            i += 1;
        }
        console.log(file_data);

        try{
            await fs.writeFile(
                path.join(__dirname , "users", `${data.username}_${data.password}`, `${data.databasename}`, `${data.filename}`),
                JSON.stringify(file_data, null, 2)
            );
            return res.json({
                message: 'Insertion successful !'
            })
        }
        catch(e){
            console.error('error writing back to the file ', e);
            return res.json({
                message: 'Insertion unsuccessful !'
            })
        }        
    }
    catch(e){
        console.error('error reading file data ', e);
        return res.json({
            message: 'Insertion unsuccessful !'
        })
    }
});

// Helper function to parse key paths
function parseKeyPath(keyPath) {
    let parts = [];
    let temp = keyPath.split(".");
    
    for (let part of temp) {
        if (part.includes("[") && part.includes("]")) {
            // Handle array indices
            let segments = part.split("[");
            parts.push(segments[0]);
            
            for (let j = 1; j < segments.length; j++) {
                let index = parseInt(segments[j].replace("]", ""));
                parts.push(index);
            }
        } else {
            parts.push(part);
        }
    }
    
    return parts;
}

app.post('/selectrow',async function(req, res){
    const data = req.body;
    console.log(data);
    try{
        let file_data = await fs.readFile(path.join(__dirname , "users", `${data.username}_${data.password}`, `${data.databasename}`, `${data.filename}`), 'utf-8');
        file_data = JSON.parse(file_data);

        let rows = [];
        let columns_to_be_sent = [];

        if (data.predefinedoptions !== 'none'){
            if (data.predefinedoptions === 'allrows'){
                rows.push(...file_data.rows);
            }
            else if (data.predefinedoptions === 'first100'){
                for (let i = 0; i < Math.min(100, file_data.rows.length); i++) {
                    rows.push(file_data.rows[i]);
                }
            }
            else if (data.predefinedoptions === 'last100'){
                for (let i = Math.max(0, file_data.rows.length - 100); i < file_data.rows.length; i++) {
                    rows.push(file_data.rows[i]);
                }
            }
            columns_to_be_sent = file_data.columns;
        } //remember all conditions have to be fulfilled for the operation to be performed..like AND between conditions
        else if (data.selected_columns && data.conditions){
            for (let row of file_data.rows){
                let flag = 1;
                for (let condition of data.conditions){
                    let operation = condition[1];
                    if (operation === 'equals'){
                        if (!(row[condition[0]] == condition[2])) flag = 0;
                    }
                    else if (operation === 'notequals'){
                        if (!(row[condition[0]] != condition[2])) flag = 0;
                    }
                    else if (operation === 'lessthan'){
                        if (!(row[condition[0]] < condition[2])) flag = 0;
                    }
                    else if (operation === 'morethan'){
                        if (!(row[condition[0]] > condition[2])) flag = 0;
                    }
                    else if (operation === 'lessthanequals'){
                        if (!(row[condition[0]] <= condition[2])) flag = 0;
                    }
                    else if (operation === 'morethanequals'){
                        if (!(row[condition[0]] >= condition[2])) flag = 0;
                    }
                    else if (operation === 'in'){
                        let column_type;
                        file_data.columns.forEach(column=>{
                            if (column.name === condition[0]) column_type=column.type;
                        });

                        if (column_type === 'float' || column_type === 'int'){
                            if (!(condition[2].map(Number).includes(row[condition[0]]))) flag = 0;
                        }
                        else if (column_type === 'string'){
                            if (!(condition[2].includes(row[condition[0]]))) flag = 0;
                        }
                    }
                }

                if (flag){
                    if (data.selected_columns[0] === '*'){
                        rows.push(row);
                    }
                    else{
                        let obj = {};
                        for (let column of data.selected_columns){
                            obj[column] = row[column];
                        }
                        rows.push(obj);
                    }
                }
            }
            for (let column of file_data.columns){
                if (column.name in rows[0]){
                    columns_to_be_sent.push(column);
                }
            }
        }
        else if (data.selected_columns){
            if (data.selected_columns[0] === '*'){
                rows.push(...file_data.rows);
            }
            else{
                for (let row of file_data.rows){
                    let obj = {};
                    for (let column of data.selected_columns){
                        obj[column] = row[column];
                    }
                    rows.push(obj);
                }
            }
            for (let column of file_data.columns){
                if (column.name in rows[0]){
                    columns_to_be_sent.push(column);
                }
            }
        }
        else if (data.conditions){
            for (let row of file_data.rows){
                let flag = 1;
                for (let condition of data.conditions){
                    let operation = condition[1];
                    if (operation === 'equals'){
                        if (!(row[condition[0]] == condition[2])) flag = 0;
                    }
                    else if (operation === 'notequals'){
                        if (!(row[condition[0]] != condition[2])) flag = 0;
                    }
                    else if (operation === 'lessthan'){
                        if (!(row[condition[0]] < condition[2])) flag = 0;
                    }
                    else if (operation === 'morethan'){
                        if (!(row[condition[0]] > condition[2])) flag = 0;
                    }
                    else if (operation === 'lessthanequals'){
                        if (!(row[condition[0]] <= condition[2])) flag = 0;
                    }
                    else if (operation === 'morethanequals'){
                        if (!(row[condition[0]] >= condition[2])) flag = 0;
                    }
                    else if (operation === 'in'){
                        let column_type;
                        file_data.columns.forEach(column=>{
                            if (column.name === condition[0]) column_type=column.type;
                        });

                        if (column_type === 'float' || column_type === 'int'){
                            if (!(condition[2].map(Number).includes(row[condition[0]]))) flag = 0;
                        }
                        else if (column_type === 'string'){
                            if (!(condition[2].includes(row[condition[0]]))) flag = 0;
                        }
                    }
                }

                if (flag) rows.push(row);
            }
            columns_to_be_sent = file_data.columns;
        }

        await fs.writeFile(
            path.join(__dirname, "users", `${data.username}_${data.password}`, data.databasename, 'result.json'),
            JSON.stringify({
                rows: rows,
                columns: columns_to_be_sent,
                type: "table"
            }, null, 2)
        );

        return res.json({
            message: 'Row(s) selection successful !_rowData'
        });
    }
    catch(e){
        console.error('error reading file data ', e);
        return res.json({
                message: 'Row(s) selection unsuccessful !'
            })
    }
});

app.post('/filedetails', async function(req, res){
    const data = req.body;
    try{
        let file_data = await fs.readFile(path.join(__dirname , "users", `${data.username}_${data.password}`, `${data.databasename}`, `${data.filename}`), 'utf-8');
        file_data = JSON.parse(file_data);

        delete file_data.filetype;

        console.log(file_data);
        res.json(file_data);
    }
    catch(e){
        console.log('error retrieving file details ', e);
    }
});

app.post('/selectkeyvalue', async function(req, res){
    const data = req.body;
    console.log(data);
    let send_data = {}
    //special case for updating and replacing the whole array
    if (data.selected_keys.includes(-1)){
        data.selected_keys.splice(data.selected_keys.indexOf(-1), 1);
    }
    if (data.selected_keys.includes('all')){
        data.selected_keys.splice(data.selected_keys.indexOf('all'), 1);
    }

    try{
        let file_data = await fs.readFile(path.join(__dirname , "users", `${data.username}_${data.password}`, `${data.databasename}`, `${data.filename}`), 'utf-8');
        file_data = JSON.parse(file_data);

        delete file_data.filetype;

        console.log(file_data);
        console.log(data);

        if (data.predefinedoptions != 'none'){
            let keys = Object.keys(file_data);
            if (data.predefinedoptions === 'allkeys'){
                for(const key in file_data){
                    send_data[key]=file_data[key];
                }
            }
            else if (data.predefinedoptions === 'first10'){
                for (let i = 0; i < 10 && i < keys.length; i++){
                    send_data[keys[i]] = file_data[keys[i]];
                }
            }
            else if (data.predefinedoptions === 'last10'){
                for (let i = Math.max(0, keys.length - 10); i < keys.length; i++){
                    send_data[keys[i]] = file_data[keys[i]];
                }
            }
        }
        else if (data.selected_keys){
            let parent_value = file_data;
            for (let i = 0; i < data.selected_keys.length; i++){

                if (data.selected_keys[i] == null){
                        send_data[data.selected_keys[i-1]] = parent_value;
                        break;
                }
                else if (typeof data.selected_keys[i] == 'string'){
                    if (data.selected_keys[i] == 'all'){
                        send_data[data.selected_keys[i-1]] = parent_value;
                        break;
                    }
                    else{
                        parent_value = parent_value[data.selected_keys[i]];
                        if (i === data.selected_keys.length - 1) 
                            send_data[data.selected_keys[i]] = parent_value;
                    }
                }
                else if (typeof data.selected_keys[i] == 'number'){
                    parent_value = parent_value[data.selected_keys[i]];
                    if (i === data.selected_keys.length - 1) send_data[data.selected_keys[i-1]] = parent_value;
                }
                
            }
        }
        console.log(send_data);

        await fs.writeFile(
            path.join(__dirname, "users", `${data.username}_${data.password}`, data.databasename, 'result.json'),
            JSON.stringify(send_data, null, 2)
        );

        return res.json({message:"Key-Value Selection Successful_keyValueData"});
    }
    catch(e){
        console.log('error retrieving right key ', e);
        return res.json({message: "Error Retrieving Key-Value "});
    }
});

app.post('/updaterow', async function (req, res) {
    const data = req.body;

    try {
        let file_data = await fs.readFile(
            path.join(__dirname, "users", `${data.username}_${data.password}`, data.databasename, data.filename),
            'utf-8'
        );

        file_data = JSON.parse(file_data);
        const columns = file_data.columns;
        const rows = file_data.rows;

        // helper: get column metadata
        const colMap = {};
        for (const c of columns) colMap[c.name] = c;

        for (let row of rows) {

            // 🔹 check conditions
            let match = true;
            if (data.conditions) {
                for (let [col, op, val] of data.conditions) {
                    val = isNaN(val) ? val : Number(val);

                    if (
                        (op === 'equals' && row[col] != val) ||
                        (op === 'notequals' && row[col] == val) ||
                        (op === 'lessthan' && row[col] >= val) ||
                        (op === 'morethan' && row[col] <= val) ||
                        (op === 'lessthanequals' && row[col] > val) ||
                        (op === 'morethanequals' && row[col] < val)
                    ) {
                        match = false;
                        break;
                    }
                    else if (op === 'in'){
                        let column_type;
                        file_data.columns.forEach(column=>{
                            if (column.name === col) column_type=column.type;
                        });

                        if (column_type === 'float' || column_type === 'int'){
                            if (!(val.map(Number).includes(row[col]))) match = false;
                        }
                        else if (column_type === 'string'){
                            if (!(val.includes(row[col]))) match = false;
                        }
                    }
                }
            }

            if (!match) continue;

            // 🔹 validate updates BEFORE applying
            for (let [colName, newVal] of data.columns) {
                const col = colMap[colName];

                // 🚫 SERIAL cannot be updated
                if (col.constraints.includes('serial')) {
                    return res.json({ message: `Cannot update SERIAL column "${colName}"` });
                }

                // 🔹 type casting
                if (col.type === 'int') newVal = Number(newVal);
                if (col.type === 'float') newVal = Number(newVal);
                if (col.type === 'string') newVal = String(newVal);

                // 🔹 NOT NULL
                if (col.constraints.includes('not_null') && (newVal === '' || newVal === null || Number.isNaN(newVal))) {
                    return res.json({ message: `NOT NULL constraint failed on "${colName}"` });
                }

                // 🔹 UNIQUE / PRIMARY KEY
                if (col.constraints.includes('unique') || col.constraints.includes('primary_key')) {
                    const duplicate = rows.some(r => r !== row && r[colName] === newVal);
                    if (duplicate) {
                        return res.json({ message: `Duplicate value "${newVal}" for "${colName}"` });
                    }
                }
            }

            // 🔹 apply updates (safe now)
            for (let [colName, newVal] of data.columns) {
                row[colName] = newVal;
            }

            columns.forEach(column => {
                if (column.type === 'derivative'){
                    row[column.name] = evaluateDerivedColumn(column.expression, row);
                }
            });
        }

        await fs.writeFile(
            path.join(__dirname, "users", `${data.username}_${data.password}`, data.databasename, data.filename),
            JSON.stringify(file_data, null, 2)
        );

        return res.json({ message: 'Row updation successful' });

    } catch (e) {
        console.error(e);
        return res.json({ message: 'Row updation unsuccessful' });
    }
});

app.post('/updatekeyvalue', async function(req, res){
    const data = req.body;
    console.log('Raw data:', data);
    
    // Parse selected_keys if it's a string
    if (typeof data.selected_keys === 'string') {
        try {
            data.selected_keys = JSON.parse(data.selected_keys);
        } catch (e) {
            console.error('Error parsing selected_keys:', e);
        }
    }

    //special case for updating and replacing the whole array
    if (data.selected_keys.includes(-1)){
        data.selected_keys.splice(data.selected_keys.indexOf(-1), 1);
    }
    if (data.selected_keys.includes('all')){
        data.selected_keys.splice(data.selected_keys.indexOf('all'), 1);
    }
    
    // Clean up selected_keys
    if (data.selected_keys && Array.isArray(data.selected_keys)) {
        data.selected_keys = data.selected_keys.filter(key => 
            key !== null && key !== undefined && key !== '' && key !== 'none'
        );
    }
    
    console.log('Processed data:', data);
    
    try{
        let file_data = await fs.readFile(path.join(__dirname , "users", `${data.username}_${data.password}`, `${data.databasename}`, `${data.filename}`), 'utf-8');
        file_data = JSON.parse(file_data);
        console.log(data.selected_keys, data.update_value);

        if (data.selected_keys && data.selected_keys.length > 0){
            let parent_value = file_data;
            
            // Navigate to the parent of the target key
            for (let i = 0; i < data.selected_keys.length - 1; i++){
                let key = data.selected_keys[i];
                
                // Handle both string keys and numeric indices
                if (typeof key === 'number') {
                    parent_value = parent_value[key];
                } else {
                    parent_value = parent_value[key];
                }
            }

            // Get the last key and update its value
            let lastkey = data.selected_keys[data.selected_keys.length - 1];
            let updatevalue;
            
            try{
                updatevalue = JSON.parse(data.update_value);
            }
            catch{
                updatevalue = data.update_value;
            }
            
            parent_value[lastkey] = updatevalue;
        }

        try{
            await fs.writeFile(
                path.join(__dirname , "users", `${data.username}_${data.password}`, `${data.databasename}`, `${data.filename}`),
                JSON.stringify(file_data, null, 2)
            );
            return res.json({
                message: 'Key-Value updation successful !'
            })
        }
        catch(e){
            console.error('error writing back to the file ', e);
            return res.json({
                message: 'Key-Value updation unsuccessful !'
            })
        }
    }
    catch(e){
        console.error('Error retrieving file details ', e);
        return res.json({
            message: 'Key-Value updation unsuccessful !'
        })
    }
});

app.post('/deleterow', async function(req, res){
    const data = req.body;
    console.log(data);
    try{
        let file_data = await fs.readFile(path.join(__dirname , "users", `${data.username}_${data.password}`, `${data.databasename}`, `${data.filename}`), 'utf-8');
        file_data = JSON.parse(file_data);

        if (data.predefinedoptions !== 'none'){
            if (data.predefinedoptions === 'allrows'){
                file_data.rows = [];
            }
            else if (data.predefinedoptions === 'first100') {
                file_data.rows = file_data.rows.slice(100); // removes first 100
            } else if (data.predefinedoptions === 'last100') {
                file_data.rows = file_data.rows.slice(0, -100); // removes last 100
            }
        }
        else if (data.selected_columns && data.conditions){
            // for (let row of file_data.rows){
            for (let i = 0; i < file_data.rows.length; i++){
                let flag = 1;
                let row = file_data.rows[i];
                for (let condition of data.conditions){
                    let operation = condition[1];
                    if (operation === 'equals'){
                        if (!(row[condition[0]] == condition[2])) flag = 0;
                    }
                    else if (operation === 'notequals'){
                        if (!(row[condition[0]] != condition[2])) flag = 0;
                    }
                    else if (operation === 'lessthan'){
                        if (!(row[condition[0]] < condition[2])) flag = 0;
                    }
                    else if (operation === 'morethan'){
                        if (!(row[condition[0]] > condition[2])) flag = 0;
                    }
                    else if (operation === 'lessthanequals'){
                        if (!(row[condition[0]] <= condition[2])) flag = 0;
                    }
                    else if (operation === 'morethanequals'){
                        if (!(row[condition[0]] >= condition[2])) flag = 0;
                    }
                    else if (operation === 'in'){
                        let column_type;
                        file_data.columns.forEach(column=>{
                            if (column.name === condition[0]) column_type=column.type;
                        });

                        if (column_type === 'float' || column_type === 'int'){
                            if (!(condition[2].map(Number).includes(row[condition[0]]))) flag = 0;
                        }
                        else if (column_type === 'string'){
                            if (!(condition[2].includes(row[condition[0]]))) flag = 0;
                        }
                    }
                }
                console.log(row, flag);

                if (flag){
                    if (data.selected_columns[0] === '*'){
                        file_data.rows.splice(i, 1);
                        i--;
                    }
                    else{
                        for (let column of data.selected_columns){
                            // obj[column] = row[column];
                            delete file_data.rows[i][column];
                        }
                    }
                }
            }
        }
        else if (data.selected_columns){
            if (data.selected_columns[0] === '*'){
                file_data.rows = [];
            }
            else{
                for (let i = 0; i < file_data.rows.length; i++){
                    for (let column of data.selected_columns){
                        delete file_data.rows[i][column];
                    }
                }
            }
        }
        else if (data.conditions){
            for (let i = 0; i < file_data.rows.length; i++){
                let flag = 1;
                let row = file_data.rows[i];
                for (let condition of data.conditions){
                    let operation = condition[1];
                    if (operation === 'equals'){
                        if (!(row[condition[0]] == condition[2])) flag = 0;
                    }
                    else if (operation === 'notequals'){
                        if (!(row[condition[0]] != condition[2])) flag = 0;
                    }
                    else if (operation === 'lessthan'){
                        if (!(row[condition[0]] < condition[2])) flag = 0;
                    }
                    else if (operation === 'morethan'){
                        if (!(row[condition[0]] > condition[2])) flag = 0;
                    }
                    else if (operation === 'lessthanequals'){
                        if (!(row[condition[0]] <= condition[2])) flag = 0;
                    }
                    else if (operation === 'morethanequals'){
                        if (!(row[condition[0]] >= condition[2])) flag = 0;
                    }
                }

                if (flag){
                    file_data.rows.splice(i, 1);
                    i--;
                }
            }
        }
        console.log(file_data.rows);
        try{
            fs.writeFile(path.join(__dirname , "users", `${data.username}_${data.password}`, `${data.databasename}`, `${data.filename}`),
            JSON.stringify(file_data, null, 2));
            return res.json({
                message: 'Row(s) deletion successful !'
            })
        }
        catch(e){
            console.error('error writing back to the file ', e);
            return res.json({
                message: 'Row(s) deletion unsuccessful !'
            })
        }
    }
    catch(e){
        console.error('error reading file data ', e);
    }
});

app.post('/deletekeyvalue', async function(req, res){
    const data = req.body;
    console.log(data);

    //special case for deleting the whole array
    if (data.selected_keys.includes(-1)){
        data.selected_keys.splice(data.selected_keys.indexOf(-1), 1);
    }

    try{
        let file_data = await fs.readFile(path.join(__dirname , "users", `${data.username}_${data.password}`, `${data.databasename}`, `${data.filename}`), 'utf-8');
        file_data = JSON.parse(file_data);

        delete file_data.filetype;

        if (data.predefinedoptions != 'none'){
            let keys = Object.keys(file_data);
            if (data.predefinedoptions === 'allkeys'){
                for (let key of keys){
                    delete file_data[key];
                }
            }
            else if (data.predefinedoptions === 'first10'){
                for (let i = 0; i < 10 && i < keys.length; i++){
                    delete file_data[keys[i]];
                }
            }
            else if (data.predefinedoptions === 'last10'){
                for (let i = Math.max(0, keys.length - 10); i < keys.length; i++){
                    delete file_data[keys[i]];
                }
            }
        }
        else if (data.selected_keys){
            let parent_value = null;
            let current_value = file_data;
            let parent_key = null;

            for (let i = 0; i < data.selected_keys.length; i++){
                if (data.selected_keys[i] == 'none'){
                    break;
                }
                else if (typeof data.selected_keys[i] == 'string'){
                    if (data.selected_keys[i] == 'all'){
                        // Delete the entire parent key
                        if (parent_value !== null && parent_key !== null) {
                            delete parent_value[parent_key];
                        }
                        break;
                    }
                    else{
                        if (i === data.selected_keys.length - 1) {
                            // Last key - delete it
                            delete current_value[data.selected_keys[i]];
                        }
                        else {
                            // Navigate deeper
                            parent_value = current_value;
                            parent_key = data.selected_keys[i];
                            current_value = current_value[data.selected_keys[i]];
                        }
                    }
                }
                else if (typeof data.selected_keys[i] == 'number'){
                    if (i === data.selected_keys.length - 1) {
                        // Last index - delete from array
                        if (Array.isArray(current_value)) {
                            current_value.splice(data.selected_keys[i], 1);
                        }
                    }
                    else {
                        // Navigate deeper into array
                        parent_value = current_value;
                        parent_key = data.selected_keys[i];
                        current_value = current_value[data.selected_keys[i]];
                    }
                }
            }
        }
        
        try{
            let data_to_write = {"filetype": "json"};
            Object.assign(data_to_write, file_data);
            console.log(data_to_write);

            await fs.writeFile(
                path.join(__dirname , "users", `${data.username}_${data.password}`, `${data.databasename}`, `${data.filename}`),
                JSON.stringify(data_to_write, null, 2)
            );
            
            return res.json({
                message: 'Key-Value pair(s) deletion successful !'
            })
        }
        catch(e){
            console.error('error writing back to the file ', e);
            return res.json({
                message: 'Key-Value pair(s) deletion unsuccessful !'
            })
        }
    }
    catch(e){
        console.error('error retrieving file data ', e);
        return res.json({
            message: 'Key-Value pair(s) deletion unsuccessful !'
        })
    }
});

app.post('/queryhistory', async function(req, res){
    let file_data, data = req.body;
    console.log(data)
    try{
        file_data = await fs.readFile(
            path.join(__dirname, "users", `${data.username}_${data.password}`, data.databasename, 'query_history.json'),
            'utf-8'
        );
        file_data = JSON.parse(file_data);
        console.log(file_data[data.filename])
        return res.json({
            history: file_data[data.filename]
        });
    }
    catch(e){
        console.log('error opening query history file', e);
    }
});

app.post('/query', async function(req, res){
    const data = req.body;
    let result, file_data,file_data2, query = data.query;
    try{
        result = await parse_query(data.query, data.username, data.password, data.databasename, data.filename);
        console.log(result);
    }
    catch(e){
        console.log(e);
    }
    res.json(result);
    console.log(2)

    try {
        file_data = await fs.readFile(
            path.join(__dirname, "users", `${data.username}_${data.password}`, data.databasename, 'query_history.json'),
            'utf-8'
        );
        file_data = JSON.parse(file_data);
        file_data[data.filename].push(query);

        file_data2 = await fs.readFile(filepath, 'utf-8');
        file_data2 = JSON.parse(file_data2);
        for (let line of file_data2){
            if (line.username === req.body.username){
                console.log('hey')
                const match = await bcrypt.compare(req.body.password, line.password);
                console.log('hey')
                console.log(match?'1':'0')
                if (match){
                    line.credits += 1;
                    console.log(1)
                    console.log(line.credits)
                    await fs.writeFile(filepath, JSON.stringify(file_data2, null, 2));
                    break;
                }
            }
        }

        await fs.writeFile(
            path.join(__dirname, "users", `${data.username}_${data.password}`, data.databasename, 'query_history.json'),
            JSON.stringify(file_data, null, 2)
        );
    } catch (e) {
        console.error(e);
    }
});

app.post('/join', async function(req, res){
    const data = req.body;
    const type = req.query.type;
    console.log(data,type)
    try{
        let message;
        let file_data_1 = await fs.readFile(path.join(__dirname , "users", `${data.username}_${data.password}`, `${data.databasename}`, `${data.filename}`), 'utf-8');
        let file_data_2 = await fs.readFile(path.join(__dirname , "users", `${data.username}_${data.password}`, `${data.databasename}`, `${data.table2}`), 'utf-8');
        file_data_1 = JSON.parse(file_data_1)
        file_data_2 = JSON.parse(file_data_2)

        let dependant_columns1 = [], dependant_columns2 = [];

        for (let column of file_data_1.columns){
            if (column.type === 'derivative' && data.primary_columns.includes(column.name)){
                let temp = extractColumnDependencies(column.expression);
                temp.forEach(t => {
                    if (!dependant_columns1.includes(t)) dependant_columns1.push(t)
                });
            }
        }

        for (let column of file_data_2.columns){
            if (column.type === 'derivative' && data.secondary_columns.includes(column.name)){
                let temp = extractColumnDependencies(column.expression);
                temp.forEach(t => {
                    if (!dependant_columns2.includes(t)) dependant_columns2.push(t)
                });
            }
        }
            console.log(dependant_columns1, dependant_columns2)
        //setting columns
        let columns_to_be_sent = [];
        {
            for (let column1 of file_data_1.columns){
                if (data.primary_columns.includes(column1.name) || dependant_columns1.includes(column1.name)){
                    columns_to_be_sent.push(column1);
                }
            }
        }
        
        {
            for (let column2 of file_data_2.columns){
                if (data.secondary_columns.includes(column2.name) || dependant_columns2.includes(column2.name)){
                    columns_to_be_sent.push(column2);
                }
            }
        }

        //setting rows
        let rows = [], flag;
        if (type === 'innerjoin'){
            message = 'Inner Join Successful';

            for (let row1 of file_data_1.rows){
                for (let row2 of file_data_2.rows){
                    if (row1[data.key1]===row2[data.key2]){
                        let temp = {};
                        for (let cell in row1){
                            if (data.primary_columns.includes(cell) || dependant_columns1.includes(cell)){
                                temp[cell] = row1[cell];
                            }
                        }
                        for (let cell in row2){
                            if (data.secondary_columns.includes(cell) || dependant_columns2.includes(cell)){
                                temp[cell] = row2[cell];
                            }
                        }
                        rows.push(temp);
                    }
                }
            }
        }
        else if (type === 'leftjoin'){
            message = 'Left Join Successful';
            for (let row1 of file_data_1.rows){
                flag = 0;
                for (let row2 of file_data_2.rows){
                    if (row1[data.key1]===row2[data.key2]){

                        let temp = {};
                        for (let cell in row1){
                            if (data.primary_columns.includes(cell) || dependant_columns1.includes(cell)){
                                temp[cell] = row1[cell];
                            }
                        }
                        for (let cell in row2){
                            if (data.secondary_columns.includes(cell) || dependant_columns2.includes(cell)){
                                temp[cell] = row2[cell];
                            }
                        }
                        rows.push(temp);

                        flag = 1;
                    }
                }
                if (flag === 0){
                    let temp = {};
                    for (let cell in row1){
                            if (data.primary_columns.includes(cell) || dependant_columns1.includes(cell)){
                                temp[cell] = row1[cell];
                            }
                        }

                    for (let column of file_data_2.columns){
                            if (data.secondary_columns.includes(column.name) || dependant_columns2.includes(column.name)){
                                console.log(column.name, column.type)
                                if (column.type === "string"){
                                    temp[column.name]="";
                                }
                                else if (column.type === "int"){
                                    temp[column.name]=null;
                                }
                                else if (column.type === "float"){
                                    temp[column.name]=null;
                                }
                            }
                        }

                    rows.push(temp);
                }
            }
        }
        else if (type === 'rightjoin'){
            message = 'Right Join Successful';

            for (let row2 of file_data_2.rows){
                flag = 0;
                for (let row1 of file_data_1.rows){
                    if (row1[data.key1]===row2[data.key2]){

                        let temp = {};
                        for (let cell in row1){
                            if (data.primary_columns.includes(cell) || dependant_columns1.includes(cell)){
                                temp[cell] = row1[cell];
                            }
                        }
                        for (let cell in row2){
                            if (data.secondary_columns.includes(cell) || dependant_columns2.includes(cell)){
                                temp[cell] = row2[cell];
                            }
                        }
                        rows.push(temp);

                        flag = 1;
                    }
                }
                if (flag === 0){
                    let temp = {};
                    for (let cell in row2){
                            if (data.secondary_columns.includes(cell) || dependant_columns2.includes(cell)){
                                temp[cell] = row2[cell];
                            }
                        }
                    console.log(temp)

                    for (let column of file_data_1.columns){
                            if (data.primary_columns.includes(column.name) || dependant_columns1.includes(column.name)){
                                console.log(column.name, column.type)
                                if (column.type === "string"){
                                    temp[column.name]="";
                                }
                                else if (column.type === "int"){
                                    temp[column.name]=null;
                                }
                                else if (column.type === "float"){
                                    temp[column.name]=null;
                                }
                            }
                        }
                    console.log(temp)

                    rows.push(temp);
                }
            }
        }
        else if (type === 'outerjoin'){
            message = 'Outer Join Successful';
            let unmatched_outer = [];
            file_data_2.rows.forEach(row => {unmatched_outer.push(row[data.key2])});
            console.log(unmatched_outer)
            for (let row1 of file_data_1.rows){
                flag = 0;
                for (let row2 of file_data_2.rows){
                    if (row1[data.key1]===row2[data.key2]){

                        let temp = {};
                        for (let cell in row1){
                            if (data.primary_columns.includes(cell) || dependant_columns1.includes(cell)){
                                temp[cell] = row1[cell];
                            }
                        }
                        for (let cell in row2){
                            if (data.secondary_columns.includes(cell) || dependant_columns2.includes(cell)){
                                temp[cell] = row2[cell];
                            }
                        }
                        rows.push(temp);

                        if (unmatched_outer.includes(row2[data.key2])){
                            unmatched_outer = unmatched_outer.filter(x => x !== row2[data.key2]);
                        }
                        flag = 1;
                    }
                }
                if (flag === 0){
                    let temp = {};
                    for (let cell in row1){
                            if (data.primary_columns.includes(cell) || dependant_columns1.includes(cell)){
                                temp[cell] = row1[cell];
                            }
                        }

                    for (let column of file_data_2.columns){
                            if (data.secondary_columns.includes(column.name) || dependant_columns2.includes(column.name)){
                                console.log(column.name, column.type)
                                if (column.type === "string"){
                                    temp[column.name]="";
                                }
                                else if (column.type === "int"){
                                    temp[column.name]=null;
                                }
                                else if (column.type === "float"){
                                    temp[column.name]=null;
                                }
                            }
                        }

                    rows.push(temp);
                }
            }
            
            // appending unmatched rows of second table
            for (let row2 of file_data_2.rows){
                if(unmatched_outer.includes(row2[data.key2])){
                    let temp = {};
                    for (let cell in row2){
                            if (data.secondary_columns.includes(cell) || dependant_columns2.includes(cell)){
                                temp[cell] = row2[cell];
                            }
                        }
                    console.log(temp)

                    for (let column of file_data_1.columns){
                            if (data.primary_columns.includes(column.name) || dependant_columns1.includes(column.name)){
                                console.log(column.name, column.type)
                                if (column.type === "string"){
                                    temp[column.name]="";
                                }
                                else if (column.type === "int"){
                                    temp[column.name]=null;
                                }
                                else if (column.type === "float"){
                                    temp[column.name]=null;
                                }
                            }
                        }
                    console.log(temp)

                    rows.push(temp);
                }
            }
        }
        else if (type === 'crossjoin'){
            message = 'Cross Join Successful';
            for (let row1 of file_data_1.rows){
                for (let row2 of file_data_2.rows){

                    let temp = {};
                    for (let cell in row1){
                        if (data.primary_columns.includes(cell) || dependant_columns1.includes(cell)){
                            temp[cell] = row1[cell];
                        }
                    }
                    for (let cell in row2){
                        if (data.secondary_columns.includes(cell) || dependant_columns2.includes(cell)){
                            temp[cell] = row2[cell];
                        }
                    }
                    rows.push(temp);
                }
            }
        }
        console.log(rows.length)
        
        //exporting
        if (data.export_table!='null'){
            let file_data = {filetype:"table",
                rows: rows,
                columns: columns_to_be_sent
            };
            await fs.writeFile(path.join(__dirname, "users", `${data.username}_${data.password}`, `${data.databasename}`, `${data.export_table}`),
                JSON.stringify(file_data, null, 2));
            
            {
                let query_history = await fs.readFile(
                    path.join(__dirname, "users", `${data.username}_${data.password}`, data.databasename, 'query_history.json'),
                    'utf-8'
                );
                query_history = JSON.parse(query_history);
                query_history[data.export_table] = [];
                writeFileSync(
                    path.join(__dirname, "users", `${data.username}_${data.password}`, data.databasename, 'query_history.json'),
                    JSON.stringify(query_history, null, 2));
            }
            
            console.log(`new ${data.export_table} file created !`)
            message += ` and Data Exported to ${data.export_table}`
        }
        console.log(rows);

        await fs.writeFile(
            path.join(__dirname, "users", `${data.username}_${data.password}`, data.databasename, 'result.json'),
            JSON.stringify({
                rows: rows,
                columns: columns_to_be_sent,
                type: "table"
            }, null, 2)
        );
        
        return res.json({
            message: `${message}_rowData`
        });
    }
    catch(e){
        console.log('error processing tables', e)
    }
});

app.post('/split', async function(req, res){
    const data = req.body;
    const type = req.query.type;
    console.log(data);
    let new_file = {
        filetype:"table",
        rows:[],
        columns:[]
    }
    try{
        let file_data = await fs.readFile(path.join(__dirname , "users", `${data.username}_${data.password}`, `${data.databasename}`, `${data.filename}`), 'utf-8');
        file_data = JSON.parse(file_data);

        //new column adding

        if(type==='verticalsplit'){

            let latest_column_names = [];

            for (let column of file_data.columns){
                if (column.constraints.includes('primary_key')){
                    latest_column_names.push(column.name);
                }
                else if(data.new_columns.includes(column.name)){
                    if (column.type === 'derivative'){
                        let temp = extractColumnDependencies(column.expression);
                        temp.forEach(t => {
                            if (!latest_column_names.includes(t)) latest_column_names.push(t)
                        });
                    }
                    if (!latest_column_names.includes(column.name)) latest_column_names.push(column.name);
                }
            }

            for (let column of file_data.columns){
                if (latest_column_names.includes(column.name)){
                    new_file.columns.push(column);
                }
            }

            file_data.columns = file_data.columns.filter(x => !latest_column_names.includes(x.name) || x.constraints.includes('primary_key'));
    
            // new_file.columns=new_file.columns.reverse();
            console.log(new_file.columns)
            console.log(file_data.columns)

            //new rows adding

            for (let i=file_data.rows.length-1; i>=0; i--){
                let temp_row = {};
                for (let new_column of new_file.columns){
                    temp_row[new_column.name]=file_data.rows[i][new_column.name]
                    if (!new_column.constraints.includes('primary_key')){
                        delete file_data.rows[i][new_column.name]
                    } 
                }
                new_file.rows.push(temp_row);
            }
            new_file.rows=new_file.rows.reverse();
            console.log(file_data, new_file)

            // removing duplicates 
            function hashRow(obj){
                return Object.keys(obj).map(key => `${key}:${obj[key]}`).join('|');
            }

            //original file duplicate removal
            let hashMap1=new Map();
            file_data.rows.forEach((row, index)=>{
                let hash=hashRow(row);

                if(!hashMap1.has(hash)){
                    hashMap1.set(hash, [])
                }
                hashMap1.get(hash).push(index)
            });

            let delete_indices=[];
            for(let [hash, indexes] of hashMap1.entries()){
                console.log(hash, indexes)
                for(let i=1; i<indexes.length; i++){
                    delete_indices.push(indexes[i])
                }
            }
            delete_indices=delete_indices.sort();
            console.log(delete_indices)
            for (let i=delete_indices.length-1; i>=0; i--){
                file_data.rows.splice(delete_indices[i], 1)
            }
            console.log(file_data.rows)

            //new file duplicate removal
            hashMap1=new Map();
            new_file.rows.forEach((row, index)=>{
                let hash=hashRow(row);

                if(!hashMap1.has(hash)){
                    hashMap1.set(hash, [])
                }
                hashMap1.get(hash).push(index)
            });

            delete_indices=[];
            for(let [hash, indexes] of hashMap1.entries()){
                console.log(hash, indexes)
                for(let i=1; i<indexes.length; i++){
                    delete_indices.push(indexes[i])
                }
            }
            delete_indices=delete_indices.sort();
            console.log(delete_indices)
            for (let i=delete_indices.length-1; i>=0; i--){
                new_file.rows.splice(delete_indices[i], 1)
            }
            console.log(new_file.rows)
   
        }
        else if (type==='horizontalsplit'){
            console.log(data.conditions)

            for (let i=file_data.rows.length-1; i>=0; i--){
                let flag = 1;
                for (let condition of data.conditions){
                    let operation = condition[1];
                    if (operation === 'equals'){
                        if (!(file_data.rows[i][condition[0]] == condition[2])) flag = 0;
                    }
                    else if (operation === 'notequals'){
                        if (!(file_data.rows[i][condition[0]] != condition[2])) flag = 0;
                    }
                    else if (operation === 'lessthan'){
                        if (!(file_data.rows[i][condition[0]] < condition[2])) flag = 0;
                    }
                    else if (operation === 'morethan'){
                        if (!(file_data.rows[i][condition[0]] > condition[2])) flag = 0;
                    }
                    else if (operation === 'lessthanequals'){
                        if (!(file_data.rows[i][condition[0]] <= condition[2])) flag = 0;
                    }
                    else if (operation === 'morethanequals'){
                        if (!(file_data.rows[i][condition[0]] >= condition[2])) flag = 0;
                    }
                    else if (operation === 'in'){
                        let column_type;
                        file_data.columns.forEach(column=>{
                            if (column.name === condition[0]) column_type=column.type;
                        });

                        if (column_type === 'float' || column_type === 'int'){
                            if (!(condition[2].map(Number).includes(file_data.rows[i][condition[0]]))) flag = 0;
                        }
                        else if (column_type === 'string'){
                            if (!(condition[2].includes(file_data.rows[i][condition[0]]))) flag = 0;
                        }
                    }
                }

                if (flag){
                    new_file.rows.push(file_data.rows[i]);
                    file_data.rows.splice(i, 1);
                } 
            }

            new_file.rows=new_file.rows.reverse();
            new_file.columns.push(...file_data.columns);
        }
        console.log(file_data, new_file)
        try{
            await fs.writeFile(
            path.join(__dirname, "users", `${data.username}_${data.password}`, data.databasename, data.filename),
            JSON.stringify(file_data, null, 2)
        );
        }
        catch(e){
            console.log('error writing back to the first file ', e)
        }

        try{
            await fs.writeFile(
            path.join(__dirname, "users", `${data.username}_${data.password}`, data.databasename, `${data.new_table_name}.txt.json`),
            JSON.stringify(new_file, null, 2)
        );

        {
                let query_history = await fs.readFile(
                    path.join(__dirname, "users", `${data.username}_${data.password}`, data.databasename, 'query_history.json'),
                    'utf-8'
                );
                query_history = JSON.parse(query_history);
                query_history[`${data.new_table_name}.txt.json`] = [];
                console.log(query_history)
                writeFileSync(
                    path.join(__dirname, "users", `${data.username}_${data.password}`, data.databasename, 'query_history.json'),
                    JSON.stringify(query_history, null, 2));
        }
    
        }
        catch(e){
            console.log('error writing back to the new file ', e)
        }

        return res.json({ message: 'Table Splitting Successful' });
    }
    catch(e){
        console.log('error reading file data ', e)
        return res.json({ message: 'Table Splitting Unsuccessful' });
    }
});

app.post('/sort', async function(req, res){
    console.log(req.body);
    let data = req.body;
    let message = "Row(s) Sorting Successful";
    let sortingkey = data.sortingkey, sortingorder = data.sortingorder, selected_columns = data.selected_columns, export_table = data.export_table;

    try{
        let file_data = await fs.readFile(path.join(__dirname , "users", `${data.username}_${data.password}`, `${data.databasename}`, `${data.filename}`), 'utf-8');
        file_data = JSON.parse(file_data);

        let columns_to_be_sent = [];

        
        file_data.rows.sort((a, b) => {
            if (typeof a[sortingkey] === 'number') {
            return sortingorder === 'asc'
                ? a[sortingkey] - b[sortingkey]
                : b[sortingkey] - a[sortingkey];
            }
            return sortingorder === 'asc'
            ? String(a[sortingkey]).localeCompare(String(b[sortingkey]))
            : String(b[sortingkey]).localeCompare(String(a[sortingkey]));
        });

        if(selected_columns.includes('*')){
            file_data.columns.forEach(column => {
                columns_to_be_sent.push(column.name);
            });
        }
        else{
            columns_to_be_sent.push(...selected_columns)
        }

        // filtering
        file_data.rows = file_data.rows.map(row =>
            Object.fromEntries(
                Object.entries(row).filter(([key]) =>
                columns_to_be_sent.includes(key)
                )
            )
            );

        
        //filtering columns
        for (let i=file_data.columns.length-1; i>=0; i--){
            if (!columns_to_be_sent.includes(file_data.columns[i].name)){
                file_data.columns.splice(i, 1);
            }
        }

        console.log(file_data)

        if (data.export_table!='null'){
            await fs.writeFile(path.join(__dirname, "users", `${data.username}_${data.password}`, `${data.databasename}`, `${data.export_table}`),
                JSON.stringify(file_data, null, 2));

            {
                let query_history = await fs.readFile(
                    path.join(__dirname, "users", `${data.username}_${data.password}`, data.databasename, 'query_history.json'),
                    'utf-8'
                );
                query_history = JSON.parse(query_history);
                query_history[data.export_table] = [];
                console.log(query_history)
                writeFileSync(
                    path.join(__dirname, "users", `${data.username}_${data.password}`, data.databasename, 'query_history.json'),
                    JSON.stringify(query_history, null, 2));
            }

            console.log(`new ${data.export_table} file created !`)
            message += ` and Data Exported to ${data.export_table}`
        }

        await fs.writeFile(
            path.join(__dirname, "users", `${data.username}_${data.password}`, data.databasename, 'result.json'),
            JSON.stringify(file_data, null, 2)
        );

        return res.json({
            message: `${message}_rowData`
        });

    }
    catch(e){
        console.error('error reading file data ', e);
        return res.json({
                message: 'Row(s) Sorting Unsuccessful !'
            })
    }
});

app.post('/get_result', async function(req, res){
    let data = req.body;
    let file_data = await fs.readFile(
            path.join(__dirname, "users", `${data.username}_${data.password}`, data.databasename, 'result.json'),
            'utf-8'
        );
    file_data = JSON.parse(file_data);
    await fs.unlink(path.join(__dirname, "users", `${data.username}_${data.password}`, data.databasename, 'result.json'));
    return res.json(file_data);
});

function locateValueOnly(valueType, operator, searchValue, obj, path = 'root') {
  let results = [];

  if (obj === null || typeof obj !== 'object') return results;

  const isArray = Array.isArray(obj);

  for (let key in obj) {
    const value = obj[key];

    const currentPath = isArray
      ? `${path}[${key}]`
      : `${path}.${key}`;

    let match = false;

    /* ---------- STRING ---------- */
    if (
      valueType === 'string' &&
      typeof value === 'string'
    ) {
      if (operator === 'equals') {
        match = value === searchValue;
      } else if (operator === 'contains') {
        match = value.includes(searchValue);
      }
    }

    /* ---------- NUMBER ---------- */
    else if (
      valueType === 'number' &&
      typeof value === 'number'
    ) {
      const num = Number(searchValue);

      if (!Number.isNaN(num)) {
        if (operator === 'equals') match = value === num;
        else if (operator === 'notequals') match = value !== num;
        else if (operator === 'lessthan') match = value < num;
        else if (operator === 'morethan') match = value > num;
        else if (operator === 'lessthanequals') match = value <= num;
        else if (operator === 'morethanequals') match = value >= num;
      }
    }

    /* ---------- BOOLEAN ---------- */
    else if (
      valueType === 'boolean' &&
      typeof value === 'boolean'
    ) {
      const bool =
        searchValue === true ||
        searchValue === 'true';

      match = value === bool;
    }

    if (match) {
      results.push({
        Path: currentPath,
        Key: key,
        Value: value
      });
    }

    /* ---------- RECURSION ---------- */
    if (value !== null && typeof value === 'object') {
      results.push(
        ...locateValueOnly(valueType, operator, searchValue, value, currentPath)
      );
    }
  }

  return results;
}


function locateKeyOnly(matchType, searchKey, obj, path = 'root') {
  let results = [];

  if (typeof obj !== 'object' || obj === null) return results;

  for (let key in obj) {
    const currentPath = Number.isNaN(Number(key)) ? `${path}.${key}` : `${path}[${key}]`;

    if ((matchType === 'exact' && key === searchKey) || (matchType === 'partial' && key.includes(searchKey)) || (matchType === 'caseinsensitive' && key.toLowerCase() === searchKey.toLowerCase())) {

      results.push({
        Path: currentPath,
        Value: obj[key],
        ValueType: Array.isArray(obj[key]) ? 'array' : typeof obj[key]
      });
    }

    // Recurse into objects & arrays
    if (typeof obj[key] === 'object') {
      results.push(...locateKeyOnly(matchType, searchKey, obj[key], currentPath));
    }
  }

  return results;
}

app.post('/find', async function(req, res){
    const data = req.body;
    console.log(data);
    let send_data;
    try{
        let file_data = await fs.readFile(path.join(__dirname , "users", `${data.username}_${data.password}`, `${data.databasename}`, `${data.filename}`), 'utf-8');
        file_data = JSON.parse(file_data);

        delete file_data.filetype;

        if (data.findType === 'key'){
            send_data = locateKeyOnly(data.matchType, data.keyName, file_data);
        }
        else if (data.findType === 'value'){
            send_data = locateValueOnly(data.valueType, data.operator, data.valueName, file_data);
        }

        await fs.writeFile(
            path.join(__dirname, "users", `${data.username}_${data.password}`, data.databasename, 'result.json'),
            JSON.stringify({send_data}, null, 2)
        );

        return res.json({message:`${data.findtype === 'key' ? 'Key' : 'Value'} Locating Successful_keyValueData`});

    }
    catch(e){
        console.log('error finding key or value', e);
        return res.json({message: "Error retrieving key-value "});
    }

});

app.post('/changeschema', async function(req, res){
    const data = req.body;
    let message = "Table Schema Change Successful";
    console.log(data);
    let column_names = data.column_names, column_types = data.column_types, constraints = data.constraints, derivatives = data.derivatives;
    try {
        let file_data = await fs.readFile(
            path.join(__dirname, "users", `${data.username}_${data.password}`, data.databasename, data.filename),
            'utf-8'
        );
        file_data = JSON.parse(file_data);

        if (data.changeschemaType === 'addcolumn'){
            //column updating
            for (let i=0; i<column_names.length; i++){
                file_data.columns.push({
                    name: column_names[i],
                    type: column_types[i],
                    expression: derivatives[i],
                    constraints: constraints[i]
                });
            }

            //row updating
            for (let i=0; i<column_types.length; i++){
                // error checking
                for (let column of file_data.columns){
                    if (constraints[i].includes('primary_key') && column.constraints.includes('primary_key')){
                        message = '2 Primary Keys Cannot Exist In A Table';
                        throw new Error();
                    }
                }
                
                let potential_columns = derivatives[i] !== '' ? extractColumnDependencies(derivatives[i]) : [];
                console.log(potential_columns)
                let value = null;

                if (column_types[i] === 'derivative'){
                    let flag = 1;
                    for (let temp_column of potential_columns){
                        let flag2 = 0;
                        for (let column of file_data.columns){
                            if (temp_column === column.name){
                                flag2=1;
                                break;
                            }
                        }
                        if (flag2===0){
                            flag=0;
                            break;
                        }
                    }
                    if (flag===1){
                        value='derivative_type';
                    }
                }
                else if (constraints[i].includes('serial')){
                    if (column_types[i] === 'int'){
                        value = 'serial_type';
                    }
                    else{
                        message = 'Serial Constraint Not Applicable On Non Integer Values';
                        throw new Error();
                    }
                }

                file_data.rows.forEach((row, j) => {
                    if (value === null){
                        if (column_types[i] === 'string') row[column_names[i]] = "";
                        else row[column_names[i]] = null;
                    }
                    else if (value === 'derivative_type'){
                        row[column_names[i]] = derivatives[i] === '' ? null : evaluateDerivedColumn(derivatives[i], row)
                    }
                    else if (value === 'serial_type'){
                        row[column_names[i]] = j+1;
                    }
                });
            }
        }
        else if (data.changeschemaType === 'removecolumn'){
            //column editing
            for (let check_column of column_names){
                for (let i=file_data.columns.length-1; i>=0; i--){
                    if (file_data.columns[i].name === check_column){
                        if (file_data.columns[i].constraints.includes('primary_key')){
                            message = "Attempt To Remove Primary Key";
                            throw new Error();
                        }
                        file_data.columns.splice(i, 1);
                    }
                }
                //row editing
                for (let row of file_data.rows){
                    delete row[check_column];
                }
            }
        }
        else if (data.changeschemaType === 'changecolumnname'){

            let new_rows = [], new_columns;

            for (let row of file_data.rows){
                let row_keys = Object.keys(row);
                let temp = {};
                for (let i=0; i<column_names.length; i++){
                    temp[column_names[i]] = row[row_keys[i]];
                }
                new_rows.push(temp)
            }
            file_data.rows = new_rows;

            for (let i=0; i<column_names.length; i++){
                file_data.columns[i].name = column_names[i];
            }
        }
        else if (data.changeschemaType === 'changecolumntype'){
            let new_rows = [], new_columns;

            for (let row of file_data.rows){
                let row_keys = Object.keys(row);
                let temp = {};
                for (let i=0; i<column_types.length; i++){
                    let value;
                    if (column_types[i] === 'int'){
                        value = parseInt(row[row_keys[i]]);
                        value = isNaN(value) ? null : value;
                    }
                    else if (column_types[i] === 'float'){
                        value = parseFloat(row[row_keys[i]]);
                        value = isNaN(value) ? null : value;
                    }
                    else if (column_types[i] === 'string'){
                        value = String(row[row_keys[i]]) === "null" ? "" : String(row[row_keys[i]]);
                    }
                    else if (column_types[i] === 'derivative'){
                        let potential_columns = derivatives[i] !== '' ? extractColumnDependencies(derivatives[i]) : [];

                        let flag = 1;
                        for (let temp_column of potential_columns){
                            let flag2 = 0;
                            for (let column of file_data.columns){
                                if (temp_column === column.name){
                                    flag2=1;
                                    break;
                                }
                            }
                            if (flag2===0){
                                flag=0;
                                break;
                            }
                        }
                        if (flag===1){
                            value = derivatives[i] === '' ? null : evaluateDerivedColumn(derivatives[i], row)
                            console.log(value);
                        }
                        else{
                            value=null;
                        }
                    }
                    temp[row_keys[i]] = value;
                }
                new_rows.push(temp)
            }
            file_data.rows = new_rows;

            for (let i=0; i<column_types.length; i++){
                file_data.columns[i].type = column_types[i];
                file_data.columns[i].expression = derivatives[i];
            }
        }
        else if (data.changeschemaType === 'changecolumnconstraints'){
            for (let i=0; i<constraints.length; i++){
                if (constraints[i].includes('serial') && !file_data.columns[i].constraints.includes('serial')){
                    file_data.rows.forEach((x, j)=>{
                        x[file_data.columns[i].name] = j+1;
                    });
                    file_data.columns[i].type = 'int';
                }
                if (constraints[i].includes('not_null') && !file_data.columns[i].constraints.includes('not_null')){
                    //row data handling
                    for (let row of file_data.rows){
                        if (row[file_data.columns[i].name]===null || row[file_data.columns[i].name] === ""){
                            message = 'Null Values Existing In The Column. Populate Values Before Declaring Column NOT NULL'
                            throw new Error();
                        }
                    }
                }
                if (constraints[i].includes('unique') && !file_data.columns[i].constraints.includes('unique')){
                    //duplicate check
                    let possible_values = [];
                    for (let row of file_data.rows){
                        if (possible_values.includes(row[file_data.columns[i].name])){
                            message = 'Duplicate Values Existing In The Column. Update Duplicate Values Before Declaring Column PRIMARY KEY'
                            throw new Error();
                        }
                        possible_values.push(row[file_data.columns[i].name])
                    }
                }
                if (constraints[i].includes('primary_key') && !file_data.columns[i].constraints.includes('primary_key')){
                    // other primary key removal
                    for(let j=0; j<file_data.columns.length; j++){
                        if (file_data.columns[j].constraints.includes('primary_key')){
                            file_data.columns[j].constraints.splice(file_data.columns[j].constraints.indexOf('primary_key'), 1);
                            break;
                        }
                    }
                    //not null check
                    for (let row of file_data.rows){
                        if (row[file_data.columns[i].name]===null || row[file_data.columns[i].name] === ""){
                            message = 'Null Values Existing In The Column. Populate Values Before Declaring Column PRIMARY KEY'
                            throw new Error();
                        }
                    }
                    //duplicate check
                    let possible_values = [];
                    for (let row of file_data.rows){
                        if (possible_values.includes(row[file_data.columns[i].name])){
                            message = 'Duplicate Values Existing In The Column. Update Duplicate Values Before Declaring Column PRIMARY KEY'
                            throw new Error();
                        }
                        possible_values.push(row[file_data.columns[i].name])
                    }
                }

                file_data.columns[i].constraints = constraints[i];
            }
        }

        console.log(file_data);
        await fs.writeFile(
            path.join(__dirname, "users", `${data.username}_${data.password}`, data.databasename, data.filename),
            JSON.stringify(file_data, null, 2)
        );
        

        return res.json({ message: message});
    }
    catch(e){
        console.log('error opening file ', e);
        return res.json({ message: message });
    }

        
});

app.post('/temp_file_writer', async function(req, res){
    let data = req.body;
    await fs.writeFile(
                path.join(__dirname, "users", `${data.username}_${data.password}`, data.databasename, data.filename),
                JSON.stringify(data.file_data, null, 2)
            );
    res.json({message: "successful"});
});

app.post('/deduct_credit', async function(req, res){
    let file_data = await fs.readFile(filepath, 'utf-8');
    file_data = JSON.parse(file_data);
    for (let line of file_data){
        if (line.username === req.body.username){
            const match = await bcrypt.compare(req.body.password, line.password);
            if (match){
                console.log(line.credits)
                if (line.credits >= 20){
                    line.credits -= 20;
                    await fs.writeFile(filepath, JSON.stringify(file_data, null, 2));
                    return res.json({message: true});
                }
                else return res.json({message: false});
            }
        }
    }
});

app.listen(port, function(){
    console.log(`server is running on port ${port}`);
});