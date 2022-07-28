// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;
import "./RETypes.sol"; 
import "./ITrigger.sol"; 
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract PriceTrigger is ITrigger, Ownable {

    struct TriggerFeed {
        address dataSource;
        bytes4 fn;
        mapping(string => string) params;
    }

    // keyword -> fn call to get data
    // if we know how to get the value, then it can be a trigger. so this serves as a list of allowed triggers
    // can have multiple, and we find median. This is a standard oracle call we can extend
    mapping(string => TriggerFeed[]) triggerFeeds;

    constructor() {
        // there isnt a cleaner way to init this struct.
        // https://docs.soliditylang.org/en/v0.7.1/070-breaking-changes.html#mappings-outside-storage
        // https://docs.soliditylang.org/en/v0.7.0/types.html?highlight=struct#structs
        TriggerFeed storage tf = triggerFeeds["eth"][0];
        tf.dataSource = 0xc0ffee254729296a45a3885639AC7E10F9d54979; // chainlink feed
        tf.fn="abic";    
        tf.params["token"] = "eth";

        tf = triggerFeeds["uni"][0]; // mutating the vars yo. I feel icky enough already whatever
        tf.dataSource = 0xc0ffee254729296a45a3885639AC7E10F9d54979; // chainlink feed
        tf.fn="abic";    
        tf.params["token"] = "uni";

        tf = triggerFeeds["wbtc"][0]; // mutating the vars yo. I feel icky enough already whatever
        tf.dataSource = 0xc0ffee254729296a45a3885639AC7E10F9d54979; // chainlink feed
        tf.fn="abic";    
        tf.params["token"] = "wbtc";    
    }

    function addTriggerFeeds(string memory param, uint idx, address dataSource, bytes4 fn, string[] memory params) public onlyOwner {
        TriggerFeed storage tf = triggerFeeds[param][idx];
        tf.dataSource = dataSource;
        tf.fn = fn;
        for (uint i = 0; i < params.length; i++){
            // TODO. need to split the params by comma.
            tf.params[params[i]] = params[i];
        }        
    }

    function _first(uint[] memory vals) private pure returns (uint) {        
        return vals[0];
    }

    function _getPrice(string memory asset) private returns (uint) {
        uint triggerFeedsLength  = 1; //TODO need to keep track of trigger feeds length separately to init this.
        TriggerFeed[] storage _triggerFeeds = triggerFeeds[asset];
        uint[] memory oracleValues = new uint[](triggerFeedsLength);
        for (uint i = 0;i < triggerFeedsLength; i++){
            TriggerFeed storage tf = _triggerFeeds[i];
            (address dataSource, bytes4 fn, mapping(string => string) storage params) = (tf.dataSource, tf.fn, tf.params);
            bytes memory oracleValue = Address.functionCall(dataSource, abi.encodeWithSelector(fn)); // bytes(params)));

            oracleValues[i] = abi.decode(oracleValue, (uint));
        }
        uint firstVal = _first(oracleValues); // TODO: we might want some aggregator function. see chainlink code and figure it out.
        return firstVal; 
    }

    function validateTrigger(RETypes.Trigger memory trigger) external view {
        (string memory asset1, string memory asset2) = abi.decode(trigger.param, (string, string)); 
        require(triggerFeeds[asset1][0].dataSource != address(0) && triggerFeeds[asset2][0].dataSource != address(0), "unauthorized trigger");
    }

    function checkTrigger(RETypes.Trigger memory trigger) external returns (bool, uint) {
        // get the val of var, so we can check if it matches trigger
        (uint val, RETypes.Ops op) = (trigger.value, trigger.op);
        (string memory asset1, string memory asset2) = abi.decode(trigger.param, (string, string)); 
        uint asset1price = _getPrice(asset1);
        uint asset2price = _getPrice(asset2); 

        uint res = asset1price/asset2price;  

        if(op == RETypes.Ops.GT){            
            return (res > val, res);
        } else if(op == RETypes.Ops.LT){
            return (res < val, res);
        }
    }
}
