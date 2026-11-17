import express from 'express';
import LoginController from '../controller/Authorization/login.mjs';

const AuthorizationRouter = express.Router();

AuthorizationRouter.post('/', LoginController.login);
AuthorizationRouter.post('/login', LoginController.login);
AuthorizationRouter.post('/switch-company', LoginController.switchCompany);
AuthorizationRouter.post('/switchCompany', LoginController.switchCompany);
AuthorizationRouter.post('/logout', LoginController.logout);
AuthorizationRouter.get('/verify', LoginController.verifyToken);
AuthorizationRouter.get('/userAuth', LoginController.getUserByAuth);
AuthorizationRouter.post('/userPortal/login', LoginController.globalLogin);
AuthorizationRouter.get('/userPortal/accounts', LoginController.getAccountsInUserPortal);



export default AuthorizationRouter;
