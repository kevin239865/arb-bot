const dateFormat = (fmt, localDate) =>  {
    // 获取当前时间的 UTC 时间（与服务器时区无关）
    const utcTime = localDate.getTime() + localDate.getTimezoneOffset() * 60 * 1000;

    // 转换为 UTC+8
    const date = new Date(utcTime + 8 * 60 * 60 * 1000);
    const opt = {
        "Y+": {value: String(date.getFullYear()), regex: /(Y+)/},
        "m+": {value: String(date.getMonth() + 1), regex: /(m+)/},
        "d+": {value: String(date.getDate()), regex: /(d+)/},
        "H+": {value: String(date.getHours()), regex: /(H+)/},
        "M+": {value: String(date.getMinutes()), regex: /(M+)/},
        "S+": {value: String(date.getSeconds()), regex: /(S+)/},
        "ms+": {value: String(date.getMilliseconds()).padStart(3, "0"), regex: /(ms+)/},
    };

    for (const [k, {value, regex}] of Object.entries(opt)) {
        const ret = regex.exec(fmt);
        if (ret) {
            const paddedValue = ret[1].length === 1 ? value : value.padStart(ret[1].length, "0");
            fmt = fmt.replace(ret[1], paddedValue);
        }
    }

    return fmt;
}

module.exports = {
    dateFormat
}