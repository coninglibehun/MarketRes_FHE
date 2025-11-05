pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract MarketResearch is ZamaEthereumConfig {
    struct SurveyResponse {
        euint32 encryptedAnswer;
        uint256 publicMetadata;
        address respondent;
        uint256 timestamp;
        uint32 decryptedAnswer;
        bool isVerified;
    }

    mapping(string => SurveyResponse) public surveyResponses;
    string[] public responseIds;

    event ResponseSubmitted(string indexed responseId, address indexed respondent);
    event ResponseDecrypted(string indexed responseId, uint32 decryptedAnswer);

    constructor() ZamaEthereumConfig() {
    }

    function submitResponse(
        string calldata responseId,
        externalEuint32 encryptedAnswer,
        bytes calldata inputProof,
        uint256 publicMetadata
    ) external {
        require(bytes(surveyResponses[responseId].respondent).length == 0, "Response already exists");
        require(FHE.isInitialized(FHE.fromExternal(encryptedAnswer, inputProof)), "Invalid encrypted input");

        surveyResponses[responseId] = SurveyResponse({
            encryptedAnswer: FHE.fromExternal(encryptedAnswer, inputProof),
            publicMetadata: publicMetadata,
            respondent: msg.sender,
            timestamp: block.timestamp,
            decryptedAnswer: 0,
            isVerified: false
        });

        FHE.allowThis(surveyResponses[responseId].encryptedAnswer);
        FHE.makePubliclyDecryptable(surveyResponses[responseId].encryptedAnswer);

        responseIds.push(responseId);
        emit ResponseSubmitted(responseId, msg.sender);
    }

    function verifyDecryption(
        string calldata responseId,
        bytes memory abiEncodedClearAnswer,
        bytes memory decryptionProof
    ) external {
        require(bytes(surveyResponses[responseId].respondent).length > 0, "Response does not exist");
        require(!surveyResponses[responseId].isVerified, "Response already verified");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(surveyResponses[responseId].encryptedAnswer);

        FHE.checkSignatures(cts, abiEncodedClearAnswer, decryptionProof);
        uint32 decodedAnswer = abi.decode(abiEncodedClearAnswer, (uint32));

        surveyResponses[responseId].decryptedAnswer = decodedAnswer;
        surveyResponses[responseId].isVerified = true;
        emit ResponseDecrypted(responseId, decodedAnswer);
    }

    function getEncryptedAnswer(string calldata responseId) external view returns (euint32) {
        require(bytes(surveyResponses[responseId].respondent).length > 0, "Response does not exist");
        return surveyResponses[responseId].encryptedAnswer;
    }

    function getResponse(string calldata responseId) external view returns (
        uint256 publicMetadata,
        address respondent,
        uint256 timestamp,
        bool isVerified,
        uint32 decryptedAnswer
    ) {
        require(bytes(surveyResponses[responseId].respondent).length > 0, "Response does not exist");
        SurveyResponse storage response = surveyResponses[responseId];

        return (
            response.publicMetadata,
            response.respondent,
            response.timestamp,
            response.isVerified,
            response.decryptedAnswer
        );
    }

    function getAllResponseIds() external view returns (string[] memory) {
        return responseIds;
    }

    function computeAverage() external view returns (uint32) {
        uint32 total = 0;
        uint32 count = 0;

        for (uint i = 0; i < responseIds.length; i++) {
            if (surveyResponses[responseIds[i]].isVerified) {
                total += surveyResponses[responseIds[i]].decryptedAnswer;
                count++;
            }
        }

        require(count > 0, "No verified responses");
        return total / count;
    }

    function computeDistribution(uint32 bucketSize) external view returns (uint32[] memory) {
        uint32 maxAnswer = 0;
        for (uint i = 0; i < responseIds.length; i++) {
            if (surveyResponses[responseIds[i]].isVerified && 
                surveyResponses[responseIds[i]].decryptedAnswer > maxAnswer) {
                maxAnswer = surveyResponses[responseIds[i]].decryptedAnswer;
            }
        }

        uint32 numBuckets = (maxAnswer / bucketSize) + 1;
        uint32[] memory distribution = new uint32[](numBuckets);

        for (uint i = 0; i < responseIds.length; i++) {
            if (surveyResponses[responseIds[i]].isVerified) {
                uint32 bucketIndex = surveyResponses[responseIds[i]].decryptedAnswer / bucketSize;
                distribution[bucketIndex]++;
            }
        }

        return distribution;
    }

    function isAvailable() public pure returns (bool) {
        return true;
    }
}


