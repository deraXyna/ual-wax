import {
    Authenticator,
    Chain,
    User,
    UALError,
} from "universal-authenticator-library";
import { UALErrorType } from "universal-authenticator-library/dist";
import {
    SignatureProvider,
    SignatureProviderArgs,
} from "eosjs/dist/eosjs-api-interfaces";
import { WaxJS } from "@waxio/waxjs/dist";
import { PushTransactionArgs } from "eosjs/dist/eosjs-rpc-interfaces";

import { WaxUser } from "./WaxUser";
import { WaxIcon } from "./WaxIcon";
import { UALWaxError } from "./UALWaxError";

//const LIMITLESS_WAX_PUBLIC_KEY: string = "PUB_K1_7FUX7yAxiff74N2GEgainGr5jYnKmeY2NjXagLMsyFbNX9Hkup";
//const LIMITLESS_WAX_BACKEND_URL: string = "api.limitlesswax.co";

export class Wax extends Authenticator {
    private wax?: WaxJS;
    private users: WaxUser[] = [];

    private initiated = false;

    private session?: { userAccount: string; pubKeys: string[] };

    private readonly waxSigningURL: string | undefined;
    private readonly waxAutoSigningURL: string | undefined;

    constructor(
        chains: Chain[],
        options?: {
            apiSigner?: SignatureProvider;
            waxSigningURL?: string | undefined;
            waxAutoSigningURL?: string | undefined;
        }
    ) {
        super(chains, options);

        this.waxSigningURL = options && options.waxSigningURL;
        this.waxAutoSigningURL = options && options.waxAutoSigningURL;
    }

    /**
     * Called after `shouldRender` and should be used to handle any async actions required to initialize the authenticator
     */
    async init(): Promise<void> {
        this.initWaxJS();

        try {
            if (this.wax) {
                if (await this.wax.isAutoLoginAvailable()) {
                    this.receiveLogin();
                } else {
                    const data = JSON.parse(
                        localStorage.getItem("ual-wax:autologin") || "null"
                    );

                    if (data && data.expire >= Date.now()) {
                        this.receiveLogin(data.userAccount, data.pubKeys);
                    }
                }
            }
        } catch (e) {
            console.log("UAL-WAX: autologin error", e);
        }

        this.initiated = true;

        console.log(`UAL-WAX: init`);
    }

    /**
     * Resets the authenticator to its initial, default state then calls `init` method
     */
    reset() {
        this.wax = undefined;
        this.users = [];
        this.initiated = false;
        this.session = undefined;
    }

    /**
     * Returns true if the authenticator has errored while initializing.
     */
    isErrored() {
        return false;
    }

    /**
     * Returns a URL where the user can download and install the underlying authenticator
     * if it is not found by the UAL Authenticator.
     */
    getOnboardingLink() {
        return "https://all-access.wax.io/";
    }

    /**
     * Returns error (if available) if the authenticator has errored while initializing.
     */
    getError(): UALError | null {
        return null;
    }

    /**
     * Returns true if the authenticator is loading while initializing its internal state.
     */
    isLoading(): boolean {
        return !this.initiated;
    }

    /**
     * Returns the style of the Button that will be rendered.
     */
    getStyle() {
        return {
            icon: WaxIcon,
            text: "WAX Cloud Wallet",
            textColor: "white",
            background: "#111111",
        };
    }

    /**
     * Returns whether or not the button should render based on the operating environment and other factors.
     * ie. If your Authenticator App does not support mobile, it returns false when running in a mobile browser.
     */
    shouldRender() {
        return true;
    }

    /**
     * Returns whether or not the dapp should attempt to auto login with the Authenticator app.
     * Auto login will only occur when there is only one Authenticator that returns shouldRender() true and
     * shouldAutoLogin() true.
     */
    shouldAutoLogin() {
        return false;
    }

    /**
     * Returns whether or not the button should show an account name input field.
     * This is for Authenticators that do not have a concept of account names.
     */
    async shouldRequestAccountName(): Promise<boolean> {
        return false;
    }

    /**
     * Returns the amount of seconds after the authentication will be invalid for logging in on new
     * browser sessions.  Setting this value to zero will cause users to re-attempt authentication on
     * every new browser session.  Please note that the invalidate time will be saved client-side and
     * should not be relied on for security.
     */
    public shouldInvalidateAfter(): number {
        return 86400;
    }

    /**
     * Login using the Authenticator App. This can return one or more users depending on multiple chain support.
     */
    async login(): Promise<User[]> {
        console.log(`UAL-WAX: login requested`);
        console.log(this.apiSigner);

        // Commented for now to support multiple wax chains such as testnets/staging in the future
        // Mainnet check:  this.chains[0].chainId !== '1064487b3cd1a897ce03ae5b6a865651747e2e152090f99c1d19d44e01aea5a4'
        if (this.chains.length > 1) {
            throw new UALWaxError(
                "WAX Could Wallet only supports one WAX chain",
                UALErrorType.Unsupported,
                null
            );
        }

        if (!this.wax) {
            throw new UALWaxError(
                "WAX Cloud Wallet not initialized yet",
                UALErrorType.Initialization,
                null
            );
        }

        try {
            if (!this.session) {
                await this.wax.login();
                this.receiveLogin();
            }

            if (!this.session) {
                throw new Error("Could not receive login information");
            }

            this.users = [
                new WaxUser(
                    this.chains[0],
                    this.session.userAccount,
                    this.session.pubKeys,
                    this.wax
                ),
            ];

            console.log(`UAL-WAX: login`, this.users);

            return this.users;
        } catch (e) {
            throw new UALWaxError(
                e.message
                    ? e.message
                    : "Could not login to the WAX Cloud Wallet",
                UALErrorType.Login,
                e
            );
        }
    }

    /**
     * Logs the user out of the dapp. This will be strongly dependent on each Authenticator app's patterns.
     */
    async logout(): Promise<void> {
        this.initWaxJS();
        this.users = [];
        this.session = undefined;

        localStorage.setItem("ual-wax:autologin", "null");

        console.log(`UAL-WAX: logout`);
    }

    /**
     * Returns true if user confirmation is required for `getKeys`
     */
    requiresGetKeyConfirmation(): boolean {
        return false;
    }

    /**
     * Returns name of authenticator for persistence in local storage
     */
    getName(): string {
        return "wax";
    }

    private receiveLogin(userAccount?: string, pubKeys?: string[]) {
        if (!this.wax) {
            return;
        }

        const login = {
            // @ts-ignore
            userAccount: userAccount || this.wax.userAccount,
            // @ts-ignore
            pubKeys: pubKeys || this.wax.pubKeys,
            expire: Date.now() + this.shouldInvalidateAfter() * 1000,
        };

        if (!login.userAccount || !login.pubKeys) {
            return;
        }

        localStorage.setItem("ual-wax:autologin", JSON.stringify(login));
        this.session = login;
    }

    private initWaxJS() {
        console.log(this.apiSigner);
        this.wax = new WaxJS({
            rpcEndpoint: this.getEndpoint(),
            tryAutoLogin: false,
            apiSigner: this.apiSigner,
            waxSigningURL: this.waxSigningURL,
            waxAutoSigningURL: this.waxAutoSigningURL,
        });
    }

    private getEndpoint() {
        return `${this.chains[0].rpcEndpoints[0].protocol}://${this.chains[0].rpcEndpoints[0].host}:${this.chains[0].rpcEndpoints[0].port}`;
    }

    apiSigner: SignatureProvider = {
        getAvailableKeys: async () => {
            return [
                "PUB_K1_7FUX7yAxiff74N2GEgainGr5jYnKmeY2NjXagLMsyFbNX9Hkup",
            ];
        },
        sign: async (
            data: SignatureProviderArgs
        ): Promise<PushTransactionArgs> => {
            if (
                data.requiredKeys.indexOf(
                    "PUB_K1_7FUX7yAxiff74N2GEgainGr5jYnKmeY2NjXagLMsyFbNX9Hkup"
                ) === -1
            ) {
                console.log("Test3");
                return {
                    signatures: [],
                    serializedTransaction: data.serializedTransaction,
                };
            }
            // TODO: Find a single source of truth for the same enum in the backend

            const request = {
                transaction: Array.from(data.serializedTransaction),
            };
            const response = await fetch(
                "https://api.limitlesswax.co/cpu-rent",
                {
                    method: "POST",
                    // mode: 'cors',
                    headers: {
                        Accept: "application/json",
                        "Content-Type": "application/json",
                        "Access-Control-Allow-Origin": "*",
                        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
                        "Access-Control-Allow-Headers":
                            "X-Requested-With,content-type",
                    },
                    body: JSON.stringify(request),
                }
            );
            console.log(response);

            if (!response.ok) {
                const body = await response.json();
                alert(body.reason);
                throw Error(body.reason || "Failed to connect to endpoint");
            }

            const json = await response.json();
            console.debug("response:", json);
            if (!json.isOk) {
                // TODO: display alert here with the json.reason
                alert(json.reason);
                alert("Go to www.cpu4.sale to get more cpu and keep playing!");
                throw Error(json.reason);
            }

            const output = {
                signatures: json.signature,
                serializedTransaction: data.serializedTransaction,
            };
            return output;
        },
    };
}
