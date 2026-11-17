import CryptoJS from 'crypto-js';
import dotenv from 'dotenv';
dotenv.config();

export const encryptPasswordFun = (str) => {
    return CryptoJS.AES.encrypt(str, process.env.passwordKey).toString();
}

export const decryptPasswordFun = (str) => {
    const decrypt = CryptoJS.AES.decrypt(str, process.env.passwordKey);
    const decryptedText = decrypt.toString(CryptoJS.enc.Utf8);
    return decryptedText;
}

export const LocalDateTime = () => {
    const now = new Date();
    const utcTime = now.getTime();
    const istOffsetInMilliseconds = 5.5 * 60 * 60 * 1000;
    const istTime = new Date(utcTime + istOffsetInMilliseconds);
    const localISOTime = istTime.toISOString();

    return localISOTime;
};

